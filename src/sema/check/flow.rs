//! Narrowing: the type of a variable or a property at a location, derived from the tests and
//! assignments on the control flow paths that reach it.

use super::decl::Predicate;
use super::errors::Container;
use super::expr::TargetKind;
use super::related::FileSpan;
use super::shape::UntypedProperty;
use super::*;
use crate::bind::{
    Decl, Flow, FlowId, FlowTarget, FnOwner, MAX_FLOW_DEPTH, MemberOwner, Parent, PatParent,
    SymbolId, UNREACHABLE, entered_clauses,
};
use crate::util::SharedSort;
use smallvec::{SmallVec, smallvec};

/// See `Checker::access_key`.
#[derive(Copy, Clone)]
pub(super) enum AccessKey {
    Name(Atom),
    /// `this[k]`, where `k` has no literal type but is a variable whose value never changes
    /// (`is_constant_key`).
    Variable(Root),
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum Root {
    Symbol(SymbolId),
    /// A name that isn't declared in the file.
    Global(Atom),
    This,
    Super,
    /// `import.meta`
    ImportMeta,
    /// `new.target`, or whatever name follows `new.`
    NewTarget(Atom),
    /// The value a pattern destructures. No expression refers to it. Tests of the variables the
    /// pattern binds narrow it.
    Pattern(PatId),
    /// The argument list of a function whose contextual signature has a single rest parameter that
    /// is a union of tuples. Tests of its parameters narrow it.
    Params(FnId),
    /// Any other expression, like `f()` in `f()["a"]`. `isMatchingReference` never matches it.
    Other,
}

/// `getAccessedPropertyName` of an access in a reference.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum AccessedName {
    Some(Atom),
    None,
    /// The name of `[k]`, for this `k`, hasn't been requested yet. Computing it (`literal_key`) may
    /// resolve a type.
    Unresolved(ExprId),
}

impl From<Option<Atom>> for AccessedName {
    fn from(name: Option<Atom>) -> AccessedName {
        name.map_or(AccessedName::None, AccessedName::Some)
    }
}

/// `.name` or `[k]` in a reference.
#[derive(Clone, Debug)]
struct Step {
    /// See `name_of_step`.
    name: std::cell::Cell<AccessedName>,
    /// The variable `k` refers to, if it's an identifier. `isMatchingReference` compares the symbols of two
    /// keys unless both have a name. `Root::Other` matches no key.
    variable: Root,
}

impl Step {
    fn from_name(name: Atom) -> Step {
        Step {
            name: std::cell::Cell::new(AccessedName::Some(name)),
            variable: Root::Other,
        }
    }
}

/// Compares steps the way `writeFlowCacheKey` writes them, which resolves the names.
impl PartialEq for Step {
    fn eq(&self, other: &Self) -> bool {
        match (self.name.get(), other.name.get()) {
            (AccessedName::None, AccessedName::None) => self.variable == other.variable,
            (a, b) => a == b,
        }
    }
}

/// `x`, `this`, `x.a.b`: something whose type can be narrowed.
#[derive(Clone, Debug)]
pub(super) struct Reference {
    file: FileId,
    root: Root,
    path: SmallVec<[Step; 4]>,
    /// How many names in `path` are `AccessedName::Unresolved`.
    unresolved: std::cell::Cell<u32>,
    /// Its expression, if it has one. Two references that differ only in position are equal.
    at: ExprId,
    /// Without an expression: the pattern, function or name it is, or the parent of the node
    /// synthesized for it.
    node: Node,
    /// True if `writeFlowCacheKey` reaches its root and has a key for it. It has none for `super`,
    /// `import.meta` or `new.target`. See `has_flow_reference_key`.
    has_key: bool,
    /// How many steps of `path` are inside the outermost comma, `satisfies` or assignment in the
    /// reference, which is where `writeFlowCacheKey` fails. `usize::MAX` if there's none.
    unkeyed: usize,
    /// The same for the outermost `satisfies`: 0 for `(o satisfies T).y`. `isMatchingReference`
    /// only looks through one in its source.
    satisfies: usize,
    /// The same for the outermost assignment: 1 for `(o.x = v).y`. `isMatchingReference` only looks
    /// through one in its target.
    assigned: usize,
    /// How many consecutive access expressions there are from the outermost one inwards, with no
    /// `!` or parentheses in between. `containsMatchingReference` stops there. 0 for the qualified
    /// name `a.b` in `typeof a.b`.
    accesses: usize,
}

impl Reference {
    /// A reference that isn't an expression in the source: `root`, or `root.a.b`.
    fn synthetic(file: FileId, root: Root, path: SmallVec<[Step; 4]>, node: Node) -> Reference {
        Reference {
            file,
            root,
            accesses: path.len(),
            path,
            unresolved: std::cell::Cell::new(0),
            at: ExprId::NONE,
            node,
            has_key: true,
            unkeyed: usize::MAX,
            satisfies: usize::MAX,
            assigned: usize::MAX,
        }
    }
}

impl PartialEq for Reference {
    fn eq(&self, other: &Self) -> bool {
        self.file == other.file && self.root == other.root && self.path == other.path
    }
}

/// Flow analysis memo tables that aren't keyed by just a node. They belong to the checker, so
/// they're dropped at the end of the task. The tables keyed by a node are fields of `Program`.
/// Those are stored with `rewrite`, because tsgo assigns the link when the computation ends,
/// overwriting what a nested computation for the same node assigned.
#[derive(Default)]
pub(super) struct FlowMemo {
    /// Built by `index_narrowing_subjects`, in field order: the file the index is for; by symbol,
    /// the first flow node with a test, `switch` or assignment that concerns it (empty if the file
    /// has no such filter); one bit per symbol, set while some call statement that mentions it
    /// isn't known to be idle; those calls, by symbol.
    narrowing_index_file: Option<FileId>,
    first_narrowing_node: Vec<u32>,
    in_call_statements: Vec<u64>,
    call_statements_by_symbol: Vec<(SymbolId, FlowId)>,
    /// Indexed by flow node: an upper bound on the node numbers reachable through its antecedents.
    /// (Only the back edge of a loop leads to a higher one.)
    max_antecedent: Vec<u32>,
    /// The same for a lower bound, up to the start of its function.
    min_antecedent: Vec<u32>,
    /// The flow nodes at which a walk resolves the name of a key, in ascending order.
    computed_key_nodes: Vec<(u32, ResolvesKey)>,
    /// The call statements and the clauses of a `switch (true)` with a union
    /// (`NarrowingSubjects::add_union`), in ascending order.
    union_nodes: Vec<u32>,
    /// For each `Flow::Reduce`: the label at the start of the `finally` block, and the node itself.
    /// The nodes of the block have the numbers in between.
    finally_blocks: Vec<(u32, u32)>,
    /// Indexed by symbol: the flow node at which its declaration initializes it.
    declaration_node: Vec<u32>,
    /// Indexed by flow node. See `highest_unsettled_call` and `first_unsettled_call`. `u32::MAX`
    /// means not computed. An entry whose call has been settled since is stale and gets recomputed.
    unsettled_call_before: Vec<u32>,
    unsettled_call_on_first_path: Vec<u32>,
    /// One bit per flow node, set for a settled call at which both searches stop no matter what's
    /// settled later. An entry that points to such a call isn't recomputed.
    stopping_calls: Vec<u64>,
    /// The functions whose `type_predicates_from_body` is being computed:
    /// `sig.resolvedTypePredicate = c.noTypePredicate`.
    type_predicates_in_progress: SmallVec<[(FileId, FnId); 2]>,
    /// `flowNodePostSuper`
    flow_node_post_super: FxHashMap<(FileId, FlowId), bool>,
    /// `finalArrayType` of an evolving array type whose element type is a union.
    final_array_types: FxHashMap<TypeId, TypeId>,
    /// Two bits per flow node of the file `settled_calls_of`. The first marks a `Flow::Call` node
    /// whose call has an entry in `effects_signatures` (settled). The second marks one whose entry
    /// is `None` (idle).
    settled_calls: Vec<(u64, u64)>,
    settled_calls_of: Option<FileId>,
    /// Indexed by flow node of the same file, or empty. For a call from which a walk passed a long
    /// run of idle calls: the node where the run ended, and how many calls it passed. See
    /// `before_idle_calls`.
    idle_runs: Vec<(FlowId, u32)>,
    /// The subjects of each test in the file `tests_of`, indexed by the test's flow node.
    tests: Vec<TestSubjects>,
    tests_of: Option<FileId>,
    /// `getTypeWithFacts`, keyed by the type and the facts, and `getAdjustedTypeWithFacts`, keyed
    /// by the type and the facts with `ADJUSTED` set.
    types_with_facts: instantiate::Recent,
    /// `getNarrowedType`, keyed by type, candidate, `assumeTrue` and `checkDerived`.
    narrowed_types: FxHashMap<(TypeId, TypeId, bool, bool), TypeId>,
    /// `narrowTypeByEquality`, keyed by the type, the unmodified type of the other operand, whether
    /// the operator is `==`, and whether the operands are equal.
    equal_types: FxHashMap<(TypeId, TypeId, bool, bool), TypeId>,
    /// `flowLoopCache`, keyed by the loop label and `getFlowReferenceKey`: the declared and the
    /// initial type, then the reference.
    flow_loop_cache: FxHashMap<FlowLoopKey, SmallVec<[(Reference, TypeId); 1]>>,
    /// `Checker::work` when it got its latest entry.
    flow_loop_cached_at: u64,
    /// `switchStatementLinks`
    switch_statement_links: FxHashMap<(FileId, StmtId), SwitchStatementLinks>,
    /// `contextFreeTypes`, for the results that depend on the incomplete type of a loop in
    /// progress. The others are in `Program::context_free_expr_types`.
    context_free_types_in_loops: FxHashMap<(FileId, ExprId), TypeId>,
    /// The depth of `stack` when each `ExhaustiveState::Computing` was set, the innermost last.
    exhaustive_states_computing: SmallVec<[usize; 2]>,
    /// `last_assignment_pos`
    last_assignment_positions: std::cell::RefCell<FxHashMap<(FileId, SymbolId), u32>>,
}

/// `FlowLoopKey`, without the reference.
type FlowLoopKey = (FileId, FlowId, TypeId, TypeId);

/// `SwitchStatementLinks`. tsgo assigns both unconditionally, so they keep the first computation's
/// result even if it saw a loop's incomplete types.
#[derive(Default)]
struct SwitchStatementLinks {
    exhaustive_state: ExhaustiveState,
    /// `None` until `switchTypesComputed`.
    switch_types: Option<std::rc::Rc<[TypeId]>>,
}

/// `ExhaustiveState`
#[derive(Copy, Clone, PartialEq, Eq, Default)]
enum ExhaustiveState {
    #[default]
    Unknown,
    Computing,
    False,
    True,
}

impl FlowMemo {
    #[inline]
    fn is_idle_call(&self, file: FileId, flow: FlowId) -> bool {
        self.settled_calls_of == Some(file)
            && self.settled_calls[flow.idx() / 64].1 & 1 << (flow.idx() % 64) != 0
    }

    #[inline]
    fn is_settled_call(&self, file: FileId, flow: FlowId) -> bool {
        self.settled_calls_of == Some(file)
            && self.settled_calls[flow.idx() / 64].0 & 1 << (flow.idx() % 64) != 0
    }

    /// True if `known`, an entry of `unsettled_call_before` or `unsettled_call_on_first_path`, is
    /// still valid.
    #[inline]
    fn is_up_to_date(&self, file: FileId, known: u32) -> bool {
        known == 0
            || known == NEVER_RETURNS
            || known != u32::MAX
                && (!self.is_settled_call(file, FlowId(known))
                    || self.stopping_calls[known as usize / 64] & 1 << (known % 64) != 0)
    }

    #[inline]
    fn builds_union(&self, flow: FlowId) -> bool {
        !self.union_nodes.is_empty() && self.union_nodes.binary_search(&flow.0).is_ok()
    }

    /// True if the loop label `flow` is inside a `finally` block. A walk that passes it then leaves
    /// a type in `flowLoopCache` that a walk starting after the block wouldn't compute itself,
    /// because for that walk the block has fewer antecedents.
    #[inline]
    fn is_in_finally_block(&self, flow: FlowId) -> bool {
        let mut blocks = self.finally_blocks.iter();
        blocks.any(|&(label, reduce)| label < flow.0 && flow.0 < reduce)
    }

    fn cached_flow_loop_type(&self, key: &FlowLoopKey, reference: &Reference) -> Option<TypeId> {
        let cached = self.flow_loop_cache.get(key)?;
        cached.iter().find(|c| c.0 == *reference).map(|c| c.1)
    }
}

/// `getNarrowedType`'s `checkDerived`. `Yes` means the test is `instanceof` or `#x in`, which uses
/// the declared `extends` relations. `No` means it's a type guard, which uses the subtype relation.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum CheckDerived {
    No,
    Yes,
}

/// How far narrowing from outside a function stays valid inside it.
#[derive(Copy, Clone)]
enum Crossing {
    No,
    /// `flowContainer` is nil.
    Yes,
    /// `flowContainer` is this many functions out from that of the reference.
    Times(u32),
    /// The expression reads a constant, so narrowing is valid up to `declarationContainer`. That's
    /// evaluated when a walk reaches the start of a function.
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

/// `sharedFlows[sharedFlowStart:]`
struct SharedFlows {
    /// The first entries. Only the first `count` are in use.
    first_entries: [(FlowId, FlowType); 8],
    count: usize,
    /// Overflow entries, added once `first_entries` was full.
    overflow_entries: FxHashMap<FlowId, FlowType>,
}

impl Default for SharedFlows {
    fn default() -> Self {
        SharedFlows {
            first_entries: [(FlowId::NONE, FlowType::new(TypeId::NEVER, false)); 8],
            count: 0,
            overflow_entries: FxHashMap::default(),
        }
    }
}

impl SharedFlows {
    fn get(&self, flow: FlowId) -> Option<FlowType> {
        let first_entries = &self.first_entries[..self.count];
        match first_entries.iter().find(|known| known.0 == flow) {
            Some(known) => Some(known.1),
            None if self.overflow_entries.is_empty() => None,
            None => {
                cold_path();
                self.overflow_entries.get(&flow).copied()
            }
        }
    }

    /// In tsgo, a node that's visited again while its type is computed gets two entries, and the
    /// search finds the first. So a second entry is dropped here.
    fn push(&mut self, flow: FlowId, ty: FlowType) {
        if self.get(flow).is_some() {
            return;
        }
        if let Some(free) = self.first_entries.get_mut(self.count) {
            *free = (flow, ty);
            self.count += 1;
        } else {
            cold_path();
            self.overflow_entries.insert(flow, ty);
        }
    }
}

/// The union reduction that `getUnionOrEvolvingArrayType` uses.
#[derive(Copy, Clone)]
enum Join {
    /// `UnionReductionLiteral`
    Literal,
    /// `UnionReductionSubtype`
    Subtype,
}

/// The operation a `getTypeAtFlowNode` invocation applies to the type at `flow.Antecedent`.
enum Pending {
    Cond(ExprId, bool),
    Switch(StmtId, u32),
    Assert(ExprId),
    /// `a.push(x)`, `a[i] = x`
    Mutation(ExprId),
    /// `x += 1`, `x++`
    Compound,
    /// `for (const k in x)`: `x` isn't null or undefined.
    NonNull,
    Nothing,
}

/// `getTypeAtFlowAssignment`'s result.
enum AtAssignment {
    Type(TypeId),
    /// The type at `flow.Antecedent`, with this operation applied.
    Antecedent(Pending),
    /// "Assignment doesn't affect reference"
    Unaffected,
}

/// How far the initial type of a walk has been determined.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Start {
    /// From `Walk::initial`.
    Known,
    /// `Walk::initial` if `assumes_initialized`, which hasn't been evaluated yet, and `declared |
    /// undefined` otherwise.
    Unsettled,
    /// `declared | undefined`, which differs from `declared` and hasn't been created yet.
    Unassigned,
}

struct Walk {
    reference: Reference,
    /// `refKey != nonDottedNameCacheKey`. `None` until a loop label needs it.
    has_reference_key: Option<bool>,
    declared: TypeId,
    /// The type of the reference where the walk ends without reaching an assignment. See
    /// `initial_of`.
    initial: TypeId,
    start: Start,
    crossing: Crossing,
    /// How many function starts the path to the current flow node has crossed. Each antecedent of a
    /// label reaches its function's start on its own path.
    crossed: u32,
    shared_flows: SharedFlows,
    /// `reduceLabels`: the start of each `finally` block being traversed backwards, and the label
    /// whose antecedents are used instead.
    reduced: Vec<(FlowId, FlowId)>,
    /// How many back edges of loops are being followed.
    back_edges: u32,
    steps: u32,
    /// The number of nested `getTypeAtFlowNode` invocations that would be in progress.
    depth: u32,
    /// The depth reached `MAX_FLOW_DEPTH` (`flowAnalysisDisabled`), so the result is errorType.
    too_deep: bool,
}

const MAX_STEPS: u32 = 2_000_000;

/// A key for a name or for `this`, not necessarily unique. 0 for any other root of a reference.
fn root_key(root: Root) -> u32 {
    match root {
        Root::Symbol(symbol) => symbol.0 << 2 | 1,
        Root::Global(name) => name.0 << 2 | 2,
        Root::This => 3,
        Root::Super
        | Root::ImportMeta
        | Root::NewTarget(_)
        | Root::Pattern(_)
        | Root::Params(_)
        | Root::Other => 0,
    }
}

/// The references a test can narrow.
#[derive(Copy, Clone, Default)]
struct TestSubjects {
    /// 0 means the test hasn't been analyzed.
    state: u32,
    /// The expressions `narrow` compares a reference with. For each: its root's `root_key`, and its
    /// first property's atom number plus one (`NO_PROPERTY` if it has no property, 0 if that's unknown or
    /// irrelevant).
    chains: [(u32, u32); 3],
}

/// The sink that `note_test` and `note_chain` report a test's subjects to.
trait NarrowingSubjects {
    fn add(&mut self, root: u32, first: u32);
    /// No further subjects need to be reported.
    fn is_full(&self) -> bool {
        false
    }
    /// Called for a key whose name can only be resolved by a query (`is_computed_key`). Returns
    /// true to bail out.
    fn bails_on_computed_key(&mut self, resolves: ResolvesKey) -> bool;
    /// Called when the test has a `&&` or `||`, for which `narrow` returns the union of two types
    /// narrowed from its input. For a reference that isn't a subject, that's
    /// `getUnionType([t, t])`, which is errorType if `t` is a name's error type and neverType if
    /// it's another `never`.
    fn add_union(&mut self);
}

/// The references for which a walk resolves a key's name when it passes a flow node.
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord)]
enum ResolvesKey {
    Never,
    /// `a[k] = v`, `if (a[k])`: only if the reference is an access. `isMatchingReference` compares
    /// the names of two accesses before their objects.
    ForAccess,
    /// `a[k]?.b` (`optionalChainContainsReference`), `a[k] === c`
    /// (`isMatchingConstructorReference`)
    Always,
}

impl NarrowingSubjects for TestSubjects {
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
        self.state |= TestSubjects::ANYTHING;
    }

    fn is_full(&self) -> bool {
        self.state & TestSubjects::ANYTHING != 0
    }

    fn bails_on_computed_key(&mut self, _: ResolvesKey) -> bool {
        self.state |= TestSubjects::ANYTHING;
        true
    }

    fn add_union(&mut self) {
        self.state |= TestSubjects::ANYTHING;
    }
}

/// Fields: by symbol, the first flow node that concerns a reference rooted at it, whatever its
/// path; the current node; what the node's keys require; whether `add_union` was called.
struct FirstNarrowingNodes<'a>(&'a mut [u32], u32, ResolvesKey, bool);

impl NarrowingSubjects for FirstNarrowingNodes<'_> {
    fn add(&mut self, root: u32, _: u32) {
        if root & 3 == 1 {
            let first = &mut self.0[(root >> 2) as usize];
            *first = (*first).min(self.1);
        }
    }

    fn bails_on_computed_key(&mut self, resolves: ResolvesKey) -> bool {
        self.2 = self.2.max(resolves);
        false
    }

    fn add_union(&mut self) {
        self.3 = true;
    }
}

/// Collects the symbols a call statement references, each once. Fields: by symbol, the last call
/// that referenced it; the current call; the collected list; what the call's keys require; whether
/// `add_union` was called.
struct CallStatementSubjects<'a>(
    &'a mut [u32],
    u32,
    &'a mut Vec<(SymbolId, FlowId)>,
    ResolvesKey,
    bool,
);

impl NarrowingSubjects for CallStatementSubjects<'_> {
    fn add(&mut self, root: u32, _: u32) {
        if root & 3 == 1 && self.0[(root >> 2) as usize] != self.1 {
            self.0[(root >> 2) as usize] = self.1;
            self.2.push((SymbolId(root >> 2), FlowId(self.1)));
        }
    }

    fn bails_on_computed_key(&mut self, resolves: ResolvesKey) -> bool {
        self.3 = self.3.max(resolves);
        false
    }

    fn add_union(&mut self) {
        self.4 = true;
    }
}

impl TestSubjects {
    const NO_PROPERTY: u32 = u32::MAX;
    const KNOWN: u32 = 1;
    /// There are more subjects than `chains` can hold, a key whose name can only be resolved by a
    /// query, or a union (`add_union`).
    const ANYTHING: u32 = 2;

    /// True if one of `chains` can be `reference`, have it as a prefix, or be the object of its
    /// last property.
    fn concerns(&self, reference: &Reference) -> bool {
        let root = root_key(reference.root);
        if root == 0 || self.state & TestSubjects::ANYTHING != 0 {
            return true;
        }
        let Some(first) = reference.path.first() else {
            return self.chains.iter().any(|chain| chain.0 == root);
        };
        let first = match first.name.get() {
            AccessedName::Some(name) => name.0.wrapping_add(1),
            AccessedName::None | AccessedName::Unresolved(_) => 0,
        };
        self.chains
            .iter()
            .any(|chain| chain.0 == root && (chain.1 == 0 || chain.1 == first))
    }
}

/// See `first_unsettled_call`.
const NEVER_RETURNS: u32 = u32::MAX - 1;

/// Key bit for `getAdjustedTypeWithFacts`. No constant in `facts` uses it.
const ADJUSTED: u32 = 1 << 31;
/// Sentinel in `FlowMemo::types_with_facts`. The answer can't be cached, so later calls compute it
/// without trying to cache it.
const NOT_CACHEABLE: u32 = u32::MAX;

/// The error `checkNonNullTypeWithReporter` reports.
#[derive(Copy, Clone)]
pub(super) enum NonNullError {
    /// 18046, 2571
    IsUnknown,
    /// `TypeFactsIsUndefined`, `TypeFactsIsNull`
    IsPossibly { undefined: bool, null: bool },
}

/// `TypeFacts`: the tests that are true for some value of a type.
pub(super) mod facts {
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
    pub(in crate::check) const EQ_UNDEFINED_OR_NULL: u32 = 1 << 18;
    pub(super) const NE_UNDEFINED: u32 = 1 << 19;
    pub(super) const NE_NULL: u32 = 1 << 20;
    pub(super) const NE_UNDEFINED_OR_NULL: u32 = 1 << 21;
    pub(in crate::check) const TRUTHY: u32 = 1 << 22;
    pub(in crate::check) const FALSY: u32 = 1 << 23;
    pub(in crate::check) const IS_UNDEFINED: u32 = 1 << 24;
    pub(in crate::check) const IS_NULL: u32 = 1 << 25;
    pub(super) const ALL: u32 = (1 << 27) - 1;

    /// All eight of `TYPEOF_NE_*`.
    const TYPEOF_NE: u32 = 0xff << 8;
    const NON_NULLISH: u32 = NE_UNDEFINED | NE_NULL | NE_UNDEFINED_OR_NULL;
    /// The extra facts that every type except `undefined`, `null` and `void` has without
    /// strictNullChecks. `StringFacts` is `StringStrictFacts` plus these.
    pub(super) const LOOSE: u32 = EQ_UNDEFINED | EQ_NULL | EQ_UNDEFINED_OR_NULL | FALSY;
    /// `BaseStringStrictFacts` and similar. For symbols, objects and functions: `SymbolStrictFacts`
    /// and similar, without `Truthy`.
    pub(super) const OF_STRING: u32 =
        TYPEOF_EQ_STRING | TYPEOF_NE & !TYPEOF_NE_STRING | NON_NULLISH;
    pub(super) const OF_NUMBER: u32 =
        TYPEOF_EQ_NUMBER | TYPEOF_NE & !TYPEOF_NE_NUMBER | NON_NULLISH;
    pub(super) const OF_BIGINT: u32 =
        TYPEOF_EQ_BIGINT | TYPEOF_NE & !TYPEOF_NE_BIGINT | NON_NULLISH;
    pub(super) const OF_BOOLEAN: u32 =
        TYPEOF_EQ_BOOLEAN | TYPEOF_NE & !TYPEOF_NE_BOOLEAN | NON_NULLISH;
    pub(super) const OF_SYMBOL: u32 =
        TYPEOF_EQ_SYMBOL | TYPEOF_NE & !TYPEOF_NE_SYMBOL | NON_NULLISH;
    pub(super) const OF_OBJECT: u32 = TYPEOF_EQ_OBJECT
        | TYPEOF_EQ_HOST_OBJECT
        | TYPEOF_NE & !(TYPEOF_NE_OBJECT | TYPEOF_NE_HOST_OBJECT)
        | NON_NULLISH;
    pub(super) const OF_FUNCTION: u32 = TYPEOF_EQ_FUNCTION
        | TYPEOF_EQ_HOST_OBJECT
        | TYPEOF_NE & !(TYPEOF_NE_FUNCTION | TYPEOF_NE_HOST_OBJECT)
        | NON_NULLISH;
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

/// `getNotEqualFactsFromTypeofSwitch`. Returns the facts that hold when none of the clauses outside
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
    fn new(reference: Reference, declared: TypeId, initial: TypeId, crossing: Crossing) -> Walk {
        Walk {
            reference,
            has_reference_key: None,
            declared,
            initial,
            start: Start::Known,
            crossing,
            crossed: 0,
            shared_flows: SharedFlows::default(),
            reduced: Vec::new(),
            back_edges: 0,
            steps: 0,
            depth: 0,
            too_deep: false,
        }
    }
}

/// `getBindingElementPropertyName`
fn binding_element_property_name(hir: &File, prop: PatPropId) -> PropKey {
    match (hir[prop].key, hir[hir[prop].value].kind) {
        (PropKey::None, PatKind::Ident(name)) => PropKey::Name(name),
        (key, _) => key,
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

/// The constant or enum member that `tryGetNameFromEntityNameExpression` takes a name from.
#[derive(Copy, Clone)]
struct KeyConstant {
    sym: Sym,
    /// `symbol.ValueDeclaration` and its file.
    file: FileId,
    declaration: Node,
    /// The name of a variable declaration.
    variable: Option<PatId>,
    /// `declaration.Type()`
    annotation: TypeNodeId,
    initializer: ExprId,
    /// The name of an enum member.
    member_name: Atom,
}

/// `IsFunctionOrSourceFile`
fn is_function_or_source_file(kind: Kind) -> bool {
    kind.is_function_like() || kind == Kind::SourceFile
}

/// `FindAncestor(node, IsFunctionOrSourceFile)`
fn function_or_source_file_of(hir: &File, node: Node) -> Node {
    hir.find_ancestor(node, |n| is_function_or_source_file(hir.kind(n)))
}

/// True for the nodes at which `markNodeAssignmentsWorker` returns without visiting the children.
fn is_skipped_by_mark_node_assignments(kind: Kind) -> bool {
    kind.is_type_node()
        || matches!(
            kind,
            Kind::InterfaceDeclaration
                | Kind::TypeAliasDeclaration
                | Kind::JSTypeAliasDeclaration
                | Kind::EnumDeclaration
        )
}

/// `markNodeAssignmentsWorker`'s `referencingFunction != declaringFunction` for `node`, an identifier
/// that assigns to a variable of `declaring_function`. Returns `None` if the walk of
/// `declaring_function` doesn't reach `node`.
fn is_marked_in_nested_function(hir: &File, declaring_function: Node, node: Node) -> Option<bool> {
    let mut referencing_function = Node::NONE;
    let mut is_marked = false;
    hir.find_ancestor(hir.parent(node), |n| {
        let kind = hir.kind(n);
        if is_skipped_by_mark_node_assignments(kind) {
            return true;
        }
        if referencing_function.is_none() && is_function_or_source_file(kind) {
            referencing_function = n;
        }
        is_marked = n == declaring_function;
        is_marked
    });
    is_marked.then_some(referencing_function != declaring_function)
}

/// See `Checker::begin_memoizable`.
struct Memoizable {
    scope: Scope,
    /// The enclosing values of `Checker::relation_too_complex` and `Checker::reliability`.
    too_complex: bool,
    reliability: u8,
}

impl<'p, 's> Checker<'p, 's> {
    /// Returns `work`'s result, plus a `Stored` if it may go in a memo table. That requires the
    /// result to be final, and that recomputing it wouldn't raise any of the flags that relations,
    /// unions and intersections raise for their callers.
    fn run_memoizable<T>(&mut self, work: impl FnOnce(&mut Self) -> T) -> (T, Option<Stored>) {
        let begun = self.begin_memoizable();
        let result = work(self);
        (result, self.end_memoizable(begun))
    }

    /// `run_memoizable` split in two, for work that isn't a single call. Pairs can nest.
    fn begin_memoizable(&mut self) -> Memoizable {
        Memoizable {
            scope: self.begin_scope(),
            too_complex: std::mem::take(&mut self.relation_too_complex),
            reliability: std::mem::take(&mut self.reliability),
        }
    }

    fn end_memoizable(&mut self, begun: Memoizable) -> Option<Stored> {
        let raises_no_flag = !self.relation_too_complex && self.reliability == 0;
        self.relation_too_complex |= begun.too_complex;
        self.reliability |= begun.reliability;
        let stored = self.end_scope_by_counters(begun.scope).ok();
        stored.filter(|_| raises_no_flag)
    }

    // ───────────────────────────── truthiness ─────────────────────────────

    /// True for the types `getDefinitelyFalsyPartOfType` returns unchanged, except `any` and
    /// `unknown`. `NaN` isn't one of them.
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

    /// `extractDefinitelyFalsyTypes`. Returns `ty`'s falsy values: `""` for `string`, nothing for
    /// an object or a type parameter.
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

    /// `getTypeFacts`. Returns the facts in `mask` that `ty` has.
    fn type_facts(&mut self, ty: TypeId, mask: u32) -> u32 {
        self.type_facts_worker(ty, mask) & mask
    }

    /// `hasTypeFacts`
    pub(super) fn has_type_facts(&mut self, ty: TypeId, mask: u32) -> bool {
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
        let facts_for = |base: u32, truthy: bool, falsy: bool| {
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
                facts_for(OF_STRING, true, true)
            }
            TypeData::StringLit { value, .. }
            | TypeData::EnumLit {
                value: EnumValue::String(value),
                ..
            } => {
                let is_empty = *value == known::empty;
                facts_for(OF_STRING, !is_empty, is_empty)
            }
            TypeData::Template { .. } => facts_for(OF_STRING, true, false),
            TypeData::Intrinsic(Intrinsic::Number) | TypeData::Enum { .. } => {
                facts_for(OF_NUMBER, true, true)
            }
            TypeData::NumberLit { bits, .. }
            | TypeData::EnumLit {
                value: EnumValue::Number(bits),
                ..
            } => {
                let is_zero = f64::from_bits(*bits) == 0.0;
                facts_for(OF_NUMBER, !is_zero, is_zero)
            }
            TypeData::Intrinsic(Intrinsic::BigInt) => facts_for(OF_BIGINT, true, true),
            TypeData::BigIntLit { .. } => {
                let is_zero = self.is_definitely_falsy(ty);
                facts_for(OF_BIGINT, !is_zero, is_zero)
            }
            TypeData::BoolLit { value, .. } => facts_for(OF_BOOLEAN, *value, !*value),
            TypeData::Intrinsic(Intrinsic::Void) => OF_VOID,
            TypeData::Intrinsic(
                Intrinsic::Undefined | Intrinsic::Missing | Intrinsic::UndefinedWidening,
            ) => OF_UNDEFINED,
            TypeData::Intrinsic(Intrinsic::Null | Intrinsic::NullWidening) => OF_NULL,
            TypeData::Intrinsic(Intrinsic::Symbol) | TypeData::UniqueSymbol { .. } => {
                facts_for(OF_SYMBOL, true, false)
            }
            TypeData::Intrinsic(Intrinsic::Object) | TypeData::EvolvingArray(_) => {
                facts_for(OF_OBJECT, true, false)
            }
            TypeData::Intrinsic(
                Intrinsic::Never
                | Intrinsic::SilentNever
                | Intrinsic::UnreachableNever
                | Intrinsic::ImplicitNever
                | Intrinsic::UniqueLiteral,
            ) => 0,
            TypeData::Union(parts) => parts
                .iter()
                .fold(0, |all, &p| all | self.type_facts_worker(p, mask)),
            // `getIntersectionTypeFacts`: next to a primitive, object types are tags.
            TypeData::Intersection(parts) => {
                let ignore_objects = self.maybe_type_of_kind(ty, tf::PRIMITIVE);
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
                let (function, object) = (
                    facts_for(OF_FUNCTION, true, false),
                    facts_for(OF_OBJECT, true, false),
                );
                let empty = if strict {
                    OF_EMPTY_OBJECT_STRICT
                } else {
                    OF_UNKNOWN
                };
                // Its members are resolved for any of these facts, even the ones all three sets
                // share, because resolving them resolves its base types.
                if mask & (empty | function | object) == 0 {
                    0
                } else if self.is_anonymous_object_type(ty) && self.is_empty_object_type(ty) {
                    empty
                } else if self.is_function_object_type(ty) {
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
        if members.has_signatures() {
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
        self.cached_type_with_facts(ty, include, |c| {
            c.filter(ty, |c, m| c.has_type_facts(m, include))
        })
    }

    /// FOR SPEED: returns the result of `compute` for `ty`, cached in `FlowMemo::types_with_facts`
    /// under `ty` and `key`. A file's tests for truthiness, `undefined` and `null` involve only a
    /// few types, and so do its `x!` and `x?.y` expressions.
    ///
    /// A result is cached only if computing it didn't change `Traces`. It didn't run a query,
    /// create a type, report an error or instantiate anything. So every lookup it made was a hit in
    /// a table that never drops entries, and the next computation would do the same. That excludes
    /// the first computation for a type whose members it resolves. It also excludes every
    /// computation that makes `NonNullable<T>` for a member, because `type_alias_instantiation`
    /// increments `instantiation_count` every time.
    fn cached_type_with_facts(
        &mut self,
        ty: TypeId,
        key: u32,
        compute: impl Fn(&mut Self) -> TypeId,
    ) -> TypeId {
        if !self.can_cache_type_facts() {
            return compute(self);
        }
        if let Some(known) = self.flow_memo.types_with_facts.get(ty.0, key) {
            if known == NOT_CACHEABLE {
                return compute(self);
            }

            return TypeId(known);
        }
        let counter_snapshot = |c: &Self| (c.counter_snapshot(), c.times_cut_short.get(), c.taints);
        let resolved = |c: &Self| (c.work, c.types().first_new_type_id());
        let (before, resolved_before) = (counter_snapshot(self), resolved(self));
        let (narrowed, stored) = self.run_memoizable(&compute);
        // `types_with_facts` can evict the answer, so this scope isn't counted. See
        // `Checker::scopes_begun`.
        self.scopes_begun -= 1;
        if stored.is_some() && counter_snapshot(self) == before {
            let facts_cache = &mut self.flow_memo.types_with_facts;
            facts_cache.put(ty.0, key, narrowed.0);
        } else if stored.is_some() && resolved(self) == resolved_before {
            // Nothing was resolved, so the next computation would change `Traces` the same way.
            let facts_cache = &mut self.flow_memo.types_with_facts;
            facts_cache.put(ty.0, key, NOT_CACHEABLE);
        }
        narrowed
    }

    /// True if the checker's current state can't change the result or the side effects of a
    /// `cached_type_with_facts` computation in a way that `Traces` doesn't show. False in two states:
    /// - An instantiation is in progress. While a mapper is active, `instantiate` with that mapper
    ///   counts only once per type. Also, `instantiate` and `members` check
    ///   `index_infos_in_instantiation` and `unresolved_members` before they look in a table.
    /// - The checker is idle. Every comparison then starts with `instantiation_count` at 0.
    fn can_cache_type_facts(&self) -> bool {
        let is_idle = self.stack.is_empty()
            && self.current_source_element.is_none()
            && self.outermost_comparison.is_none();
        !is_idle
            && self.instantiation_depth == 0
            && self.index_infos_in_instantiation.is_empty()
            && self.unresolved_members.is_empty()
    }

    /// `getAdjustedTypeWithFacts`
    fn adjusted_type_with_facts(&mut self, ty: TypeId, include: u32) -> TypeId {
        use facts::*;
        if self.is_any(ty) {
            // `any` has every fact. Intersecting with `{}` below turns an error type into
            // `errorType` and `autoType` into `anyType`.
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
        self.cached_type_with_facts(ty, include | ADJUSTED, |c| {
            c.adjusted_type_with_facts_uncached(ty, include)
        })
    }

    fn adjusted_type_with_facts_uncached(&mut self, ty: TypeId, include: u32) -> TypeId {
        use facts::*;
        let strict = self.p.files.options.strict_null_checks;
        if !strict {
            return self.type_with_facts(ty, include);
        }
        let reduced = if ty == TypeId::UNKNOWN {
            let everything = self.unknown_union_type();
            let rest = self.type_with_facts(everything, include);
            self.recombine_unknown_type(rest)
        } else {
            self.type_with_facts(ty, include)
        };
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

    /// `unknownUnionType`: `unknown` as `{} | null | undefined`.
    fn unknown_union_type(&mut self) -> TypeId {
        if !self.p.files.options.strict_null_checks {
            return TypeId::UNKNOWN;
        }
        self.union(&[
            TypeId::UNDEFINED,
            TypeId::NULL,
            TypeId::UNKNOWN_EMPTY_OBJECT,
        ])
    }

    /// `recombineUnknownType`
    fn recombine_unknown_type(&mut self, ty: TypeId) -> TypeId {
        if ty == self.unknown_union_type() {
            TypeId::UNKNOWN
        } else {
            ty
        }
    }

    /// `getGlobalNonNullableTypeInstantiation`
    fn global_non_nullable_type_instantiation(&mut self, ty: TypeId) -> TypeId {
        match self.get_global_type_alias_symbol(known::NonNullable, 1, false) {
            Some(alias) => self.type_reference(alias, &[ty]),
            None => self.intersection(&[ty, TypeId::EMPTY_OBJECT]),
        }
    }

    /// `removeNullableByIntersection`: a member that may still be the excluded type (`target`) is
    /// intersected with `{}`, or with `{} | other_ty` if it may be the other nullable type and `ty`
    /// doesn't already include that type.
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

    /// Returns what the identifier `e` refers to, as the root of a reference or as a key.
    #[inline(always)]
    fn root_of_identifier(&self, file: FileId, e: ExprId, name: Atom) -> Root {
        let symbol = self.bound(file).symbol_of_expr(e);
        if symbol.is_none() {
            Root::Global(name)
        } else {
            Root::Symbol(symbol)
        }
    }

    /// Returns `e` as a walk's reference. `isNarrowableReference` gives a flow node to more than
    /// what can be narrowed. The walk for `f()["a"]` or `(o.x = v).y` still evaluates what it
    /// passes.
    pub(super) fn reference_of(&mut self, file: FileId, e: ExprId) -> Reference {
        let hir = self.hir(file);
        let mut path: SmallVec<[Step; 4]> = SmallVec::new();
        let mut at = e;
        let (mut accesses, mut is_access) = (0, true);
        let mut unresolved = 0;
        // The number of steps outside the outermost assignment, outside the outermost `satisfies`,
        // and outside the outermost of these and the commas.
        let (mut unassigned, mut unsatisfied, mut keyed) = (usize::MAX, usize::MAX, usize::MAX);
        let root = loop {
            is_access = is_access
                && matches!(hir[at].kind, ExprKind::Dot { .. } | ExprKind::Index { .. })
                && (at == e || !is_parenthesized(hir, at));
            accesses += is_access as usize;
            match hir[at].kind {
                ExprKind::Ident(name) => break self.root_of_identifier(file, at, name),
                ExprKind::This => break Root::This,
                ExprKind::Super => break Root::Super,
                ExprKind::ImportMeta => break Root::ImportMeta,
                ExprKind::NewTarget(name) => break Root::NewTarget(name),
                ExprKind::Dot { obj, name, .. } => {
                    path.push(Step::from_name(name));
                    at = obj;
                }
                ExprKind::Index { obj, index, .. } => {
                    let step = self.step_of_element_access(file, index);
                    unresolved += u32::from(matches!(step.name.get(), AccessedName::Unresolved(_)));
                    path.push(step);
                    at = obj;
                }
                ExprKind::NonNull(x) => at = x,
                // `isMatchingReference` looks through these when they occur in the narrowed
                // reference. `writeFlowCacheKey` handles none of them.
                ExprKind::Satisfies { expr: x, .. } => {
                    unsatisfied = unsatisfied.min(path.len());
                    keyed = keyed.min(path.len());
                    at = x;
                }
                ExprKind::Binary {
                    op: BinOp::Comma,
                    right: x,
                    ..
                } => {
                    keyed = keyed.min(path.len());
                    at = x;
                }
                ExprKind::Assign { target, .. } => {
                    unassigned = unassigned.min(path.len());
                    keyed = keyed.min(path.len());
                    at = target;
                }
                _ => break Root::Other,
            }
        };
        path.reverse();
        let inside = |outside: usize| path.len().checked_sub(outside).unwrap_or(usize::MAX);
        let (unkeyed, satisfies, assigned) =
            (inside(keyed), inside(unsatisfied), inside(unassigned));
        let has_key = unkeyed == usize::MAX
            && !matches!(
                root,
                Root::Super | Root::ImportMeta | Root::NewTarget(_) | Root::Other
            );
        Reference {
            file,
            root,
            path,
            unresolved: std::cell::Cell::new(unresolved),
            at: e,
            node: Node::NONE,
            has_key,
            unkeyed,
            satisfies,
            assigned,
            accesses,
        }
    }

    /// `Step::variable` of `[index]`.
    fn variable_of_key(&self, file: FileId, index: ExprId) -> Root {
        let hir = self.hir(file);
        match hir[index].kind {
            ExprKind::Ident(name) if !is_parenthesized(hir, index) => {
                self.root_of_identifier(file, index, name)
            }
            _ => Root::Other,
        }
    }

    /// `[index]` as a step of a reference.
    fn step_of_element_access(&mut self, file: FileId, index: ExprId) -> Step {
        let hir = self.hir(file);
        let is_entity_name = matches!(hir[index].kind, ExprKind::Ident(_) | ExprKind::Dot { .. })
            && !is_parenthesized(hir, index);
        let name: AccessedName = if !is_entity_name {
            self.literal_key(file, index).into()
        } else {
            match self.key_constant(file, index) {
                None => AccessedName::None,
                // FOR SPEED: a name that can be found without resolving a type is computed
                // immediately.
                Some(constant) if self.is_name_of_key_constant_settled(&constant) => {
                    self.name_of_key_constant(file, index, &constant).into()
                }
                Some(_) => AccessedName::Unresolved(index),
            }
        };
        let mut variable = self.variable_of_key(file, index);
        // FOR SPEED: check once, here, whether `[k]`'s variable is constant. `isMatchingReference`
        // and `writeFlowCacheKey` check each time they reach it.
        if name == AccessedName::None && !self.is_constant_key(file, variable) {
            variable = Root::Other;
        }
        Step {
            name: std::cell::Cell::new(name),
            variable,
        }
    }

    /// `getAccessedPropertyName` of the access `reference.path[step]`.
    #[inline]
    fn name_of_step(&mut self, reference: &Reference, step: usize) -> Option<Atom> {
        match reference.path[step].name.get() {
            AccessedName::Some(name) => Some(name),
            AccessedName::None => None,
            AccessedName::Unresolved(index) => self.resolve_name_of_step(reference, step, index),
        }
    }

    #[cold]
    fn resolve_name_of_step(
        &mut self,
        reference: &Reference,
        step: usize,
        index: ExprId,
    ) -> Option<Atom> {
        let name = self.literal_key(reference.file, index);
        reference.path[step].name.set(name.into());
        let unresolved = reference.unresolved.get();
        reference.unresolved.set(unresolved.saturating_sub(1));
        name
    }

    /// `tryGetElementAccessExpressionName`. Returns the property that `a[index]` accesses, if the
    /// syntax determines it or `index` is a constant that represents a single name. Returns `None`
    /// for a parenthesized key.
    pub(super) fn literal_key(&mut self, file: FileId, index: ExprId) -> Option<Atom> {
        let hir = self.hir(file);
        if is_parenthesized(hir, index) {
            return None;
        }
        match hir[index].kind {
            ExprKind::String(s) => Some(s),
            ExprKind::Number(n) => Some(self.number_name(hir.numbers[n as usize])),
            ExprKind::Template { exprs } if exprs.is_empty() => {
                Some(hir.id_at(hir.template_texts(exprs), 0))
            }
            ExprKind::Ident(_) | ExprKind::Dot { .. } => {
                self.name_from_entity_name_expression(file, index)
            }
            _ => None,
        }
    }

    /// `tryGetNameFromEntityNameExpression`
    fn name_from_entity_name_expression(&mut self, file: FileId, node: ExprId) -> Option<Atom> {
        let constant = self.key_constant(file, node)?;
        self.name_of_key_constant(file, node, &constant)
    }

    /// The part of `tryGetNameFromEntityNameExpression` that doesn't resolve a type.
    fn key_constant(&self, file: FileId, node: ExprId) -> Option<KeyConstant> {
        let sym = self.resolve_entity_name_expression(file, node, SymFlags::VALUE)?;
        let files = self.files();
        let flags = files.flags(sym);
        if !flags.intersects(SymFlags::CONST | SymFlags::ENUM_MEMBER) {
            return None;
        }
        // `ValueDeclaration`: a type of the same name may be declared first.
        let is_value = |d: &Decl| matches!(d, Decl::Var(_) | Decl::EnumMember(_));
        let (decl_file, decl) = if flags.contains(SymFlags::MERGED) {
            files.decls_of(sym).into_iter().find(|(_, d)| is_value(d))?
        } else {
            (
                sym.file,
                *files.symbol(sym).decls.iter().find(|&d| is_value(d))?,
            )
        };
        let hir = self.hir(decl_file);
        match decl {
            Decl::EnumMember(m) => Some(KeyConstant {
                sym,
                file: decl_file,
                declaration: hir.node(m),
                variable: None,
                annotation: TypeNodeId::NONE,
                initializer: hir[m].init,
                member_name: hir[m].name,
            }),
            Decl::Var(pat) => {
                // Not a variable bound by a pattern.
                let PatParent::Var(d) = self.bound(decl_file).pat_parent[pat.idx()] else {
                    return None;
                };
                Some(KeyConstant {
                    sym,
                    file: decl_file,
                    declaration: hir.node(d),
                    variable: Some(pat),
                    annotation: hir[d].ty,
                    initializer: hir[d].init,
                    member_name: Atom::NONE,
                })
            }
            _ => None,
        }
    }

    /// Not in tsgo. True if every type `name_of_key_constant` requests is already cached.
    fn is_name_of_key_constant_settled(&mut self, constant: &KeyConstant) -> bool {
        let (decl_file, initializer) = (constant.file, constant.initializer);
        let annotation = (decl_file, constant.annotation);
        let is_resolved = match constant.variable {
            Some(_) if constant.annotation.is_some() => self
                .p
                .type_node_types
                .get(&self.task, &annotation)
                .is_some(),
            Some(pat) => self
                .p
                .pat_types
                .get(&self.task, &(decl_file, pat))
                .is_some(),
            None => true,
        };
        is_resolved
            && (initializer.is_none()
                || matches!(
                    self.hir(decl_file)[initializer].kind,
                    ExprKind::String(_) | ExprKind::Number(_)
                )
                || self.cached_type_of_expr(decl_file, initializer).is_some())
    }

    /// The rest of `tryGetNameFromEntityNameExpression`.
    fn name_of_key_constant(
        &mut self,
        file: FileId,
        node: ExprId,
        constant: &KeyConstant,
    ) -> Option<Atom> {
        let (decl_file, initializer) = (constant.file, constant.initializer);
        // `tryGetTypeFromTypeNode(declaration)`, which doesn't push a resolution for the constant.
        if constant.annotation.is_some() {
            let ty = self.type_from_node(decl_file, constant.annotation);
            if let Some(name) = self.property_name_of_type(ty) {
                return Some(name);
            }
        }
        // A declaration in another file counts as declared.
        if decl_file == file {
            let usage = self.hir(file).node(node);
            if !self.is_block_scoped_name_declared_before_use(file, constant.declaration, usage) {
                return None;
            }
        }
        if initializer.is_none() {
            // An enum member yields its name, not its assigned number.
            return (constant.member_name.is_some()).then_some(constant.member_name);
        }
        // `getTypeOfExpression` of the initializer, even if there's an annotation that doesn't
        // resolve. It doesn't push a resolution for the constant, and the type isn't widened. The
        // declaration creates `Symbol()`'s unique symbol type from just the syntax
        // (`getESSymbolLikeTypeForNode`).
        let ty = if constant.variable.is_some()
            && constant.annotation.is_none()
            && self.is_symbol_or_symbol_for_call(decl_file, initializer)
        {
            self.type_of_symbol(constant.sym)
        } else {
            self.get_type_of_expression(decl_file, initializer)
        };
        self.property_name_of_type(ty)
    }

    /// `isConstantVariable` for a name that isn't declared in the file: a constant from another
    /// script or the library.
    fn is_global_constant(&self, name: Atom) -> bool {
        let files = self.files();
        files
            .global(name, SymFlags::VALUE)
            .is_some_and(|sym| files.flags(sym).contains(SymFlags::CONST))
    }

    /// From `isMatchingReference` and `writeFlowCacheKey`. True if `variable`, a `Step::variable`,
    /// is a constant, or a parameter, `catch` binding or local `let` that's never assigned.
    fn is_constant_key(&self, file: FileId, variable: Root) -> bool {
        match variable {
            Root::Symbol(symbol) => {
                self.name_of_value_declaration(file, symbol).is_some()
                    && self.is_constant_name(file, symbol)
            }
            Root::Global(name) => self.is_global_constant(name),
            _ => false,
        }
    }

    /// Returns the key that distinguishes `this[index]` from `this[other]`, for
    /// `is_assigned_in_constructor`.
    pub(super) fn access_key(&mut self, file: FileId, index: ExprId) -> Option<AccessKey> {
        if let Some(name) = self.literal_key(file, index) {
            return Some(AccessKey::Name(name));
        }
        let variable = self.variable_of_key(file, index);
        (self.is_constant_key(file, variable)).then_some(AccessKey::Variable(variable))
    }

    /// `getFlowReferenceKey(f) != nonDottedNameCacheKey`
    fn has_flow_reference_key(&mut self, reference: &Reference) -> bool {
        let unkeyed = match reference.unkeyed {
            usize::MAX => 0,
            unkeyed => unkeyed,
        };
        // `writeFlowCacheKey` handles `[k]` before it moves on to the object.
        for step in (unkeyed..reference.path.len()).rev() {
            if self.name_of_step(reference, step).is_none()
                && !self.is_constant_key(reference.file, reference.path[step].variable)
            {
                return false;
            }
        }
        reference.has_key
    }

    /// `isMatchingReference` of `e` and the first `len` steps of `reference`. The source is the
    /// reference, or `e` if `is_source`.
    fn matches_prefix(
        &mut self,
        reference: &Reference,
        len: usize,
        e: ExprId,
        is_source: bool,
    ) -> bool {
        let file = reference.file;
        let hir = self.hir(file);
        let (mut at, mut remaining) = (e, len);
        loop {
            // At this point the reference is an assignment, which is only looked through in the
            // target.
            if !is_source && remaining == reference.assigned {
                return false;
            }
            // At this point it's an access, not a `satisfies`, which is only looked through in the
            // source.
            let is_access = remaining != 0 && !(is_source && remaining == reference.satisfies);
            match hir[at].kind {
                ExprKind::NonNull(x) => at = x,
                ExprKind::Assign { target, .. } if !is_source => at = target,
                ExprKind::Satisfies { expr, .. } if is_source => at = expr,
                ExprKind::Binary {
                    op: BinOp::Comma,
                    right,
                    ..
                } => at = right,
                ExprKind::Binary { .. } | ExprKind::Assign { .. } => return false,
                ExprKind::Dot { obj, name, .. } => {
                    if !is_access || self.name_of_step(reference, remaining - 1) != Some(name) {
                        return false;
                    }
                    remaining -= 1;
                    at = obj;
                }
                ExprKind::Index { obj, index, .. } => {
                    // The source's name is resolved first, whatever the target is. The target's
                    // name is resolved only if the source has one.
                    let source = if is_source {
                        self.literal_key(file, index)
                    } else if is_access {
                        self.name_of_step(reference, remaining - 1)
                    } else {
                        None
                    };
                    if !is_access {
                        return false;
                    }
                    let target = match source {
                        None => None,
                        Some(_) if is_source => self.name_of_step(reference, remaining - 1),
                        Some(_) => self.literal_key(file, index),
                    };
                    let is_same_key = if target.is_some() {
                        source == target
                    } else {
                        // Check for the same variable first, then whether it's constant.
                        let variable = reference.path[remaining - 1].variable;
                        variable != Root::Other
                            && variable == self.variable_of_key(file, index)
                            && self.is_constant_key(file, variable)
                    };
                    if !is_same_key {
                        return false;
                    }
                    remaining -= 1;
                    at = obj;
                }
                _ if remaining != 0 => {
                    if !is_source {
                        self.name_of_step(reference, remaining - 1);
                    }
                    return false;
                }
                _ if is_source && reference.satisfies == 0 => return false,
                ExprKind::Ident(name) => {
                    return reference.root == self.root_of_identifier(file, at, name);
                }
                ExprKind::This => return reference.root == Root::This,
                ExprKind::Super => return reference.root == Root::Super,
                ExprKind::ImportMeta => return reference.root == Root::ImportMeta,
                ExprKind::NewTarget(name) => return reference.root == Root::NewTarget(name),
                _ => return false,
            }
        }
    }

    /// `isMatchingReference(reference, e)`
    pub(super) fn matches(&mut self, reference: &Reference, e: ExprId) -> bool {
        self.matches_prefix(reference, reference.path.len(), e, false)
    }

    /// True if an entry of `flow_loops` pushed when `stack` had `depth` frames is on
    /// `flowLoopStack` now. `checkExpressionCached` empties `flowLoopStack`, and it computes what a
    /// resolution caches, so a resolution entered since the push hides the entry. There are two
    /// exceptions: while `checkDeclarationInitializer` gets the type from
    /// `getQuickTypeOfExpression`, which checks the callee uncached, and in the resolution of a
    /// `...rest`, for which it checks the initializer uncached (`CheckModeRestBindingElement`).
    pub(super) fn is_flow_loop_visible(&self, depth: usize) -> bool {
        let depth = depth.min(self.stack.len());
        !self.stack[depth..].iter().enumerate().any(|(i, &q)| {
            let is_quick = |&(from, to): &(usize, usize)| (from..to).contains(&(depth + i));
            self.is_resolution(q) && !self.quick_initializers.iter().any(is_quick)
        })
    }

    /// Returns the `quick_initializers` entry for a declaration whose resolutions are right below
    /// `stack[to]`.
    pub(super) fn resolutions_below(&self, to: usize) -> (usize, usize) {
        // A declaration whose name is a pattern has no symbol and so no resolution. The binding
        // element's resolutions are below the frames of the enclosing patterns.
        let is_pattern = |q: &&Query| matches!(**q, Query::Pat(..)) && !self.is_resolution(**q);
        let patterns = self.stack[..to].iter().rev().take_while(is_pattern).count();
        let mut below = self.stack[..to - patterns].iter();
        let from = below
            .rposition(|&q| !self.is_resolution(q))
            .map_or(0, |i| i + 1);
        (from, to)
    }

    /// True if `flowLoopStack` isn't empty, so a reference's types are the ones a loop has
    /// collected so far.
    pub(super) fn is_in_flow_loop(&self) -> bool {
        self.flow_loop_pushed_at().is_some()
    }

    /// Returns `stack`'s depth when the pass over the innermost loop of `flowLoopStack` began.
    pub(super) fn flow_loop_pushed_at(&self) -> Option<usize> {
        (self.flow_loops.last().map(|pushed| pushed.5))
            .filter(|&pushed_at| self.is_flow_loop_visible(pushed_at))
    }

    /// Returns `stack`'s depth when the top of `flowLoopStack` was pushed, if that was after
    /// `stack[since]` was entered. Otherwise its depth when `isExhaustiveSwitchStatement` set the
    /// innermost `ExhaustiveStateComputing`. That function continues with an empty `flowLoopStack`
    /// (`checkExpressionCached`), and a recheck from `stack[since]` stops at that state.
    pub(super) fn flow_loop_pushed_since(&self, since: usize) -> Option<usize> {
        let pushed = self.flow_loops.last().map(|pushed| pushed.5);
        let computing = self.flow_memo.exhaustive_states_computing.last();
        pushed
            .filter(|&depth| depth > since && self.is_flow_loop_visible(depth))
            .or_else(|| computing.copied().filter(|&depth| depth > since))
    }

    /// True if `flowLoopCache` has gained an entry since the frame with serial number `serial` was
    /// pushed.
    pub(super) fn is_flow_loop_cached_since(&self, serial: u64) -> bool {
        self.flow_memo.flow_loop_cached_at >= serial
    }

    /// True if `flow_loop_pushed_since` may return a depth.
    #[inline]
    pub(super) fn is_flow_loop_or_exhaustive_state_in_progress(&self) -> bool {
        !self.flow_loops.is_empty() || !self.flow_memo.exhaustive_states_computing.is_empty()
    }

    /// `containsMatchingReference(reference, e)`: `e` is `x.a` or `x` for `x.a.b`.
    fn contains_matching_reference(&mut self, reference: &Reference, e: ExprId) -> bool {
        let len = reference.path.len();
        (len - reference.accesses..len)
            .rev()
            .any(|len| self.matches_prefix(reference, len, e, false))
    }

    /// `isOrContainsMatchingReference(reference, e)`
    fn is_or_contains_matching_reference(&mut self, reference: &Reference, e: ExprId) -> bool {
        self.matches(reference, e) || self.contains_matching_reference(reference, e)
    }

    /// `optionalChainContainsReference(source, reference)`, where `source` is `e` without its
    /// parentheses. True if `e` is `reference?.a.b`, so if `e` has a value, so does the reference.
    fn optional_chain_contains(&mut self, reference: &Reference, e: ExprId) -> bool {
        let hir = self.hir(reference.file);
        let mut source = e;
        // `IsOptionalChain`: the parser gives `x!` `NodeFlagsOptionalChain` when it finds a link
        // without `?.` after it (`tryReparseOptionalChain`).
        let mut is_before_link = false;
        loop {
            let (expression, chain) = match hir[source].kind {
                ExprKind::Dot { obj, chain, .. } | ExprKind::Index { obj, chain, .. } => {
                    (obj, chain)
                }
                ExprKind::Call(c) => (hir[c].callee, hir[c].chain),
                ExprKind::NonNull(x) if is_before_link => (x, Chain::Continue),
                _ => return false,
            };
            if chain == Chain::No {
                return false;
            }
            if self.matches_prefix(reference, reference.path.len(), expression, true) {
                return true;
            }
            if is_parenthesized(hir, expression) {
                return false;
            }
            is_before_link = chain == Chain::Continue;
            source = expression;
        }
    }

    /// Returns `e` as an access to a discriminant property of the reference, if it is one.
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
        let access = self.candidate_discriminant_access(reference, e)?;
        // Using the declared type keeps a property a discriminant after the members that made it
        // one have been narrowed away.
        let is_subset =
            is_declared_union && (ty == declared || self.is_type_subset_of_union(ty, declared));
        let tested_type = if is_subset { declared } else { ty };
        self.is_discriminant_property(tested_type, access.name)
            .then_some(access)
    }

    /// `isTypeSubsetOfUnion` without its enum rule. True if each member of `source` is a member of
    /// the union `target`. It runs for every condition that every reference passes, so a search per
    /// member makes n tests of a union of n members cost n^4.
    fn is_type_subset_of_union(&self, source: TypeId, target: TypeId) -> bool {
        // Both are in `compare_types` order, so one pass finds a subset's members.
        let mut rest = self.parts(target).iter();
        (self.parts(source).iter()).all(|member| rest.any(|it| it == member))
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
    /// `x.kind!` doesn't count.
    fn candidate_discriminant_access(
        &mut self,
        reference: &Reference,
        e: ExprId,
    ) -> Option<Access> {
        let hir = self.hir(reference.file);
        if let ExprKind::Ident(_) = hir[e].kind {
            return self.discriminant_alias(reference, e);
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
        // `getDiscriminantPropertyAccess` calls `getAccessedPropertyName` only for a candidate,
        // because resolving a constant key's name resolves a type.
        let name = match hir[e].kind {
            ExprKind::Dot { name, .. } => name,
            ExprKind::Index { index, .. } => self.literal_key(reference.file, index)?,
            _ => return None,
        };
        Some(Access {
            name,
            optional: chain != Chain::No,
            // `isNonNullAccess`
            non_null: matches!(hir[obj].kind, ExprKind::NonNull(_)) && !is_parenthesized(hir, obj),
        })
    }

    /// Returns the name of `symbol.ValueDeclaration`, if that's a variable declaration, parameter
    /// or binding element in `file`.
    #[inline(always)]
    fn name_of_value_declaration(&self, file: FileId, symbol: SymbolId) -> Option<PatId> {
        let files = self.files();
        match files.value_declaration(files.sym(file, symbol)) {
            Some((decl_file, Decl::Var(pat) | Decl::Param(pat))) if decl_file == file => Some(pat),
            _ => None,
        }
    }

    /// Returns the variable `e` as an alias of one of the reference's properties:
    /// `const k = x.kind`, `const { kind: k } = x`, a variable bound by the pattern that is the
    /// reference, or a parameter of the function that is the reference.
    fn discriminant_alias(&mut self, reference: &Reference, e: ExprId) -> Option<Access> {
        let file = reference.file;
        let hir = self.hir(file);
        let bound = self.bound(file);
        let symbol = bound.symbol_of_expr(e);
        let pat = if symbol.is_some() {
            self.name_of_value_declaration(file, symbol)?
        } else {
            // `getResolvedSymbol`, for a pattern: one of its variables can be a global or an export
            // of a merged namespace. An alias of a property isn't found this way, see `note_chain`.
            let ExprKind::Ident(name) = hir[e].kind else {
                return None;
            };
            if !matches!(reference.root, Root::Pattern(_)) {
                return None;
            }
            let resolved = self.symbol_of_identifier(file, e, name)?;
            match self.files().value_declaration(resolved) {
                Some((decl_file, Decl::Var(pat))) if decl_file == file => pat,
                _ => return None,
            }
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
                PatParent::Prop(parent_pat, prop)
                    if parent_pat == target
                        && hir[prop].default.is_none()
                        && !hir[prop].is_rest =>
                {
                    plain(self.literal_property_name_text(
                        file,
                        hir[prop].key,
                        hir[prop].key_pos,
                    )?)
                }
                PatParent::Elem(parent_pat, elem)
                    if parent_pat == target
                        && hir[elem].default.is_none()
                        && !hir[elem].is_rest =>
                {
                    let PatKind::Array(elems) = hir[parent_pat].kind else {
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
                    let param_index =
                        p.0 - hir[func].params.start + hir[func].this_param.is_some() as u32;
                    plain(self.number_name(param_index as f64))
                }
                _ => None,
            };
        }
        if !bound.symbol(symbol).flags.contains(SymFlags::CONST)
            || !self.is_constant_name(file, symbol)
        {
            return None;
        }
        match parent {
            PatParent::Var(d) if hir[d].ty.is_none() && hir[d].init.is_some() => {
                let init = hir[d].init;
                match hir[init].kind {
                    ExprKind::Dot { .. } | ExprKind::Index { .. } => {
                        self.candidate_discriminant_access(reference, init)
                    }
                    _ => None,
                }
            }
            // `const { kind: k } = x`, `const [k] = x`
            PatParent::Prop(parent_pat, _) | PatParent::Elem(parent_pat, _) => {
                let has_default = parent.initializer(hir).is_some();
                let PatParent::Var(d) = bound.pat_parent[parent_pat.idx()] else {
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
                match (parent, hir[parent_pat].kind) {
                    (PatParent::Prop(_, prop), _) => {
                        let name = binding_element_property_name(hir, prop);
                        plain(self.literal_property_name_text(file, name, hir[prop].key_pos)?)
                    }
                    (PatParent::Elem(_, elem), PatKind::Array(elems)) => {
                        plain(self.number_name((elem.0 - elems.start) as f64))
                    }
                    _ => None,
                }
            }
            _ => None,
        }
    }

    /// `getLiteralPropertyNameText` of the name `name` at `pos`.
    fn literal_property_name_text(
        &mut self,
        file: FileId,
        name: PropKey,
        pos: u32,
    ) -> Option<Atom> {
        let text = self.try_get_name_from_property_name(file, name, pos)?;
        (!self.atoms().is_symbol_name(text)).then_some(text)
    }

    /// `tryGetNameFromType` of `getLiteralTypeFromPropertyName` of the name `name` at `pos`.
    pub(super) fn try_get_name_from_property_name(
        &mut self,
        file: FileId,
        name: PropKey,
        pos: u32,
    ) -> Option<Atom> {
        match name {
            PropKey::Private(_) => None,
            PropKey::None => {
                let kind = NameKind::Identifier;
                let ty = self.literal_type_from_property_name(file, name, kind, pos)?;
                self.property_name_of_type(ty)
            }
            _ => self.member_name(file, name),
        }
    }

    /// `isSomeSymbolAssignedWorker`
    fn any_binding_assigned(&self, file: FileId, pat: PatId) -> bool {
        let hir = self.hir(file);
        match hir[pat].kind {
            PatKind::Missing => false,
            PatKind::Ident(_) => {
                let symbol = self.bound(file).pat_symbol[pat.idx()];
                symbol.is_some() && self.is_symbol_assigned(file, symbol)
            }
            PatKind::Object(props) => props
                .iter()
                .any(|p| self.any_binding_assigned(file, hir[p].value)),
            PatKind::Array(elems) => elems
                .iter()
                .any(|x| self.any_binding_assigned(file, hir[x].pat)),
        }
    }

    /// `isConstantReference` for the binding pattern `pat`. True if it belongs to a `const`, or to
    /// a parameter or `catch` clause none of whose names is assigned.
    fn is_constant_pattern(&self, file: FileId, pat: PatId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let root = root_pattern(bound, pat);
        match bound.pat_parent[root.idx()] {
            PatParent::Param(_) => !self.any_binding_assigned(file, root),
            PatParent::Var(d) => {
                let stmt = bound.var_stmt[d.idx()];
                if stmt.is_some() && matches!(hir[stmt].kind, StmtKind::Try { .. }) {
                    !self.any_binding_assigned(file, root)
                } else {
                    matches!(
                        hir[d].kind,
                        VarKind::Const | VarKind::Using | VarKind::AwaitUsing
                    )
                }
            }
            _ => false,
        }
    }

    /// `isConstantReference`. True if the reference's value can't have changed since a test of it
    /// was stored in a constant.
    pub(super) fn is_constant_reference(&mut self, reference: &Reference) -> bool {
        let file = reference.file;
        let hir = self.hir(file);
        if !reference.path.is_empty() {
            if reference.at.is_none() {
                return false;
            }
            // Only this exact syntax leads to the name. `a!.b`, `(a).b` and `(f(), a).b` aren't
            // recognized.
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
        }
        let is_constant_root = match reference.root {
            Root::This => true,
            Root::Symbol(s) => self.is_constant_name(file, s),
            Root::Global(name) => self.is_global_constant(name),
            Root::Pattern(p) => self.is_constant_pattern(file, p),
            Root::Super | Root::ImportMeta | Root::NewTarget(_) | Root::Params(_) | Root::Other => {
                false
            }
        };
        let steps = (0..reference.path.len()).rev();
        if !is_constant_root
            || (steps.clone()).any(|step| self.name_of_step(reference, step).is_none())
        {
            return false;
        }
        // For `a.b.c`, neither `b` in `a` nor `c` in `a.b` can be assigned.
        let mut at = reference.at;
        for step in steps {
            let (ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. }) = hir[at].kind else {
                return false;
            };
            let Some(name) = self.name_of_step(reference, step) else {
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
        true
    }

    /// `GetRootDeclaration(symbol.ValueDeclaration)` for a variable or a parameter. `None` for
    /// anything else.
    fn root_declaration(&self, file: FileId, symbol: SymbolId) -> PatParent {
        match self.name_of_value_declaration(file, symbol) {
            Some(pat) => super::errors_names_and_exports::root_declaration(self.bound(file), pat),
            None => PatParent::None,
        }
    }

    /// `isParameterOrMutableLocalVariable`
    fn is_parameter_or_mutable_local_variable(&self, file: FileId, symbol: SymbolId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        match self.root_declaration(file, symbol) {
            PatParent::Param(_) => true,
            PatParent::Var(d) => {
                let stmt = bound.var_stmt[d.idx()];
                // `IsCatchClause(declaration.Parent)`
                stmt.is_some() && matches!(hir[stmt].kind, StmtKind::Try { .. })
                    || self.is_mutable_local_variable_declaration(file, d)
            }
            _ => false,
        }
    }

    /// `isSymbolAssigned`
    fn is_symbol_assigned(&self, file: FileId, symbol: SymbolId) -> bool {
        self.last_assignment_pos(file, symbol) != 0
    }

    /// `isConstantReference` for a name. A declaration with an `export` modifier isn't constant,
    /// because the name resolves to the export symbol, which isn't followed.
    fn is_constant_name(&self, file: FileId, symbol: SymbolId) -> bool {
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
                self.bound(file).symbol(symbol).decls.first(),
                Some(&Decl::Fn(f)) if hir[f].kind == FnKind::Expr
            ),
        }
    }

    /// `isReadonlySymbol(getPropertyOfType(object, name))`
    fn is_readonly_property(&mut self, object: TypeId, name: Atom) -> bool {
        self.get_property_of_type(object, name)
            .is_some_and(|(prop, _)| self.is_readonly_symbol(prop))
    }

    /// `getNarrowedTypeOfSymbol`. Returns the type at `e` of a variable bound by a pattern that
    /// destructures a union. Tests of the pattern's other variables determine which member of the
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
        let Some(pat) = self.name_of_value_declaration(file, symbol) else {
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
        if len < 2 {
            return declared;
        }
        let root = root_pattern(bound, parent);
        let is_parameter = match bound.pat_parent[root.idx()] {
            PatParent::Param(_) => true,
            // `NodeFlagsConstant`
            PatParent::Var(d)
                if matches!(
                    hir[d].kind,
                    VarKind::Const | VarKind::Using | VarKind::AwaitUsing
                ) =>
            {
                false
            }
            _ => return declared,
        };
        // `NodeCheckFlagsInCheckIdentifier`
        if self.in_check_identifier.contains(&(file, parent)) {
            return declared;
        }
        self.in_check_identifier.push((file, parent));
        let flow = bound.flow_of_expr(e);
        let ty = 'checked: {
            let parent_ty = self.type_for_binding_element_parent(file, pat, parent);
            let parent_ty = self.map_type(parent_ty, Self::base_constraint_or_type);
            if !self.is_union(parent_ty) || is_parameter && self.any_binding_assigned(file, root) {
                break 'checked declared;
            }
            let node = hir.node(parent);
            let reference =
                Reference::synthetic(file, Root::Pattern(parent), SmallVec::new(), node);
            let mut walk = Walk::new(reference, parent_ty, parent_ty, Crossing::Yes);
            let narrowed = self.get_flow_type_of_reference(&mut walk, flow);
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
        let count = params.len() + hir[func].this_param.is_some() as usize;
        let flow = bound.flow_of_expr(e);
        // `isContextSensitiveFunctionOrObjectLiteralMethod`: a function with its own type
        // parameters takes nothing from its context.
        if count < 2
            || !matches!(
                hir[func].kind,
                FnKind::Expr | FnKind::Arrow | FnKind::Method
            )
            || !hir[func].type_params.is_empty()
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
        if !self.is_union(rest_ty)
            || !self.every_type(rest_ty, |c, m| c.is_tuple(m))
            || (params.iter()).any(|q| self.any_binding_assigned(file, hir[q].pat))
        {
            return declared;
        }
        let (root, node) = (Root::Params(func), hir.node(func));
        let reference = Reference::synthetic(file, root, SmallVec::new(), node);
        let mut walk = Walk::new(reference, rest_ty, rest_ty, Crossing::Yes);
        let narrowed = self.get_flow_type_of_reference(&mut walk, flow);
        // This is the result whether or not anything was narrowed, so a parameter declared `x?`
        // doesn't get `undefined` added.
        let index = self.number_literal((p.0 - params.start) as f64, false);
        self.indexed_access(narrowed, index)
    }

    /// `container != f.flowContainer` at the start of a function. The part that depends on the
    /// variable is evaluated once per walk.
    fn settle_crossing(&mut self, walk: &mut Walk) -> bool {
        walk.crossing = self.settled_crossing(walk.reference.file, walk.crossing);
        match walk.crossing {
            Crossing::Times(times) if walk.crossed < times => {
                walk.crossed += 1;
                true
            }
            Crossing::Yes => true,
            _ => false,
        }
    }

    /// Returns `crossing` with the part that depends on the variable evaluated.
    fn settled_crossing(&mut self, file: FileId, crossing: Crossing) -> Crossing {
        let times = match crossing {
            Crossing::No | Crossing::Yes | Crossing::Times(_) => return crossing,
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
        match times {
            0 => Crossing::No,
            u32::MAX => Crossing::Yes,
            _ => Crossing::Times(times),
        }
    }

    /// Returns `f`'s parent if `f` is `IsFunctionExpressionOrArrowFunction` or
    /// `IsObjectLiteralOrClassExpressionMethodOrAccessor`. Only those have a start node with
    /// `outer`.
    fn parent_of_function_with_outer_flow(&self, file: FileId, f: FnId) -> Option<Parent> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        match (hir[f].kind, bound.fns[f.idx()].owner) {
            (
                FnKind::Expr | FnKind::Arrow | FnKind::Method | FnKind::Getter | FnKind::Setter,
                FnOwner::Expr(x),
            ) => Some(bound.parent_of_expr(x)),
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
        }
    }

    /// `checkIdentifier`'s `declarationContainer`, for a variable or parameter in `file`.
    fn declaration_container(&self, file: FileId, symbol: SymbolId) -> Option<Container> {
        let bound = self.bound(file);
        let declared_in = match self.root_declaration(file, symbol) {
            PatParent::Param(p) => Parent::ParamDefault(p),
            PatParent::Var(d) if bound.var_stmt[d.idx()].is_some() => {
                bound.parent_of_stmt(bound.var_stmt[d.idx()])
            }
            _ => return None,
        };
        Some(self.get_control_flow_container(file, declared_in))
    }

    /// From `checkIdentifier`. Returns how many times `flowContainer` moves to the enclosing
    /// container, starting from `e`'s, until it's `declarationContainer`. Returns `u32::MAX` if no
    /// walk can leave `declarationContainer` or a container isn't known.
    fn flow_containers_up_to_declaration(&self, file: FileId, symbol: SymbolId, e: ExprId) -> u32 {
        let bound = self.bound(file);
        let enclosing_parent = |f: FnId| self.parent_of_function_with_outer_flow(file, f);
        let Some(declaration_container) = self.declaration_container(file, symbol) else {
            return u32::MAX;
        };
        if !matches!(declaration_container, Container::Fn(f) if enclosing_parent(f).is_some()) {
            return u32::MAX;
        }
        let mut flow_container = self.get_control_flow_container(file, bound.parent_of_expr(e));
        let mut times = 0;
        while flow_container != declaration_container {
            let parent = match flow_container {
                Container::Fn(f) => enclosing_parent(f),
                Container::Other => return u32::MAX,
                _ => None,
            };
            let Some(parent) = parent else { break };
            times += 1;
            flow_container = self.get_control_flow_container(file, parent);
        }
        times
    }

    /// `initialType` without `assumeInitialized`: `undefined` for `autoType` and `autoArrayType`,
    /// else `declared | undefined`.
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

    /// Returns the reference's type where `walk` ends without reaching an assignment.
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

    /// True if `initial_of` is the declared type.
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

    /// Returns the type that the property `access` reads has in `ty`, and whether it's `never` in
    /// some member. `None` means the property is ignored.
    fn type_of_discriminant(&mut self, ty: TypeId, access: Access) -> Option<(TypeId, bool)> {
        let remove_nullable = self.p.files.options.strict_null_checks
            && (access.optional || access.non_null)
            && self.maybe_type_of_kind(ty, tf::NULLABLE);
        let base = if remove_nullable {
            self.type_with_facts(ty, facts::NE_UNDEFINED_OR_NULL)
        } else {
            ty
        };
        let mut prop = self.type_of_property_of_type(base, access.name)?;
        if prop == TypeId::UNRESOLVED {
            return None;
        }
        let has_never = prop.is_never()
            || (self.parts(base).iter()).any(|&m| {
                self.type_of_property_or_index_signature_of_type(m, access.name)
                    .is_some_and(|t| t.is_never())
            });
        if remove_nullable && access.optional {
            prop = self.optional(prop);
        }
        Some((prop, has_never))
    }

    /// Returns the members of `ty` whose property `name` overlaps `narrowed`.
    fn members_with_discriminant(&mut self, ty: TypeId, name: Atom, narrowed: TypeId) -> TypeId {
        self.filter(ty, |c, m| {
            let discriminant = c
                .type_of_property_or_index_signature_of_type(m, name)
                .unwrap_or(TypeId::UNKNOWN);
            !discriminant.is_never()
                && !narrowed.is_never()
                && c.are_comparable(narrowed, discriminant)
        })
    }

    // ───────────────────────────── tests ─────────────────────────────

    /// True if `narrow` may narrow `reference` by `expr`, the flow node `flow`'s test. If false,
    /// `narrow` wouldn't run a query and would return its input type.
    fn is_test_about(&mut self, reference: &Reference, flow: FlowId, expr: ExprId) -> bool {
        let file = reference.file;
        // Every comparison resolves the name of the reference's outermost key.
        if reference.unresolved.get() != 0 {
            cold_path();
            return true;
        }
        let memo = &self.flow_memo;
        if memo.tests_of == Some(file) && memo.tests[flow.idx()].state != 0 {
            return memo.tests[flow.idx()].concerns(reference);
        }
        self.analyze_test(file, flow, expr).concerns(reference)
    }

    #[inline(never)]
    fn analyze_test(&mut self, file: FileId, flow: FlowId, expr: ExprId) -> TestSubjects {
        let mut about = TestSubjects {
            state: TestSubjects::KNOWN,
            ..TestSubjects::default()
        };
        self.note_test(file, expr, 0, &mut about);
        let nodes = self.bound(file).flow.len();
        let memo = &mut self.flow_memo;
        // Nearly all walks are in the file being checked.
        if self.task.file == Some(file) && memo.tests_of != Some(file) {
            memo.tests_of = Some(file);
            memo.tests.clear();
            memo.tests.resize(nodes, TestSubjects::default());
        }
        if memo.tests_of == Some(file) {
            memo.tests[flow.idx()] = about;
        }
        about
    }

    /// Adds to `about` every expression `narrow` compares a reference with for the test `e`.
    /// `level` counts the constants holding a test that have been followed so far.
    fn note_test(&self, file: FileId, e: ExprId, level: u32, about: &mut impl NarrowingSubjects) {
        if about.is_full() || self.is_stack_low() {
            return;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        self.note_chain(file, e, true, TestSubjects::NO_PROPERTY, about);
        match hir[e].kind {
            // `const ok = test; if (ok)`
            ExprKind::Ident(_) if level < 5 => {
                let symbol = bound.symbol_of_expr(e);
                if symbol.is_some()
                    && bound.symbol(symbol).flags.contains(SymFlags::CONST)
                    && let Some(pat) = self.name_of_value_declaration(file, symbol)
                    && let PatParent::Var(d) = bound.pat_parent[pat.idx()]
                    && hir[d].ty.is_none()
                    && hir[d].init.is_some()
                {
                    self.note_test(file, hir[d].init, level + 1, about);
                }
            }
            ExprKind::Call(c) => {
                let call = &hir[c];
                // `hasMatchingArgument`: for `x.a`, an argument or a receiver `x` is enough to
                // resolve the effects signature of the call.
                for argument in hir.ids(call.args) {
                    self.note_chain(file, argument, true, 0, about);
                }
                if let ExprKind::Dot { obj, .. } = hir[call.callee].kind {
                    self.note_chain(file, obj, false, 0, about);
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
                        if let ExprKind::Index { index, .. } = hir[side].kind
                            && self.is_computed_key(file, index)
                            && about.bails_on_computed_key(ResolvesKey::Always)
                        {
                            return;
                        }
                        match hir[side].kind {
                            ExprKind::Unary {
                                op: UnOp::Typeof,
                                operand,
                            } => self.note_chain(
                                file,
                                operand,
                                true,
                                TestSubjects::NO_PROPERTY,
                                about,
                            ),
                            // `test(x) === true`
                            _ if matches!(hir[other].kind, ExprKind::True | ExprKind::False) => {
                                self.note_test(file, side, level, about);
                            }
                            _ => {
                                self.note_chain(file, side, true, TestSubjects::NO_PROPERTY, about)
                            }
                        }
                    }
                }
                BinOp::Instanceof => {
                    self.note_chain(file, left, false, TestSubjects::NO_PROPERTY, about)
                }
                // `"a" in x` narrows `x.a`.
                BinOp::In => self.note_chain(file, right, false, 0, about),
                BinOp::Comma => self.note_test(file, right, level, about),
                BinOp::And | BinOp::Or => {
                    about.add_union();
                    self.note_test(file, left, level, about);
                    self.note_test(file, right, level, about);
                }
                _ => {}
            },
            _ => {}
        }
    }

    /// `note_test` for `narrow_by_asserted`, which doesn't build a union for a `&&`.
    fn note_asserted(&self, file: FileId, e: ExprId, about: &mut CallStatementSubjects<'_>) {
        if self.is_stack_low() {
            return;
        }
        match self.hir(file)[e].kind {
            ExprKind::Binary {
                op: BinOp::And,
                left,
                right,
            } => {
                self.note_asserted(file, left, about);
                self.note_asserted(file, right, about);
            }
            _ => self.note_test(file, e, 0, about),
        }
    }

    /// True if `literal_key` may resolve a type to get the key `index`'s name, which requires an
    /// entity name. False if that name is a variable in the file that isn't a constant, is bound by
    /// a pattern, or has neither an annotation nor an initializer, like a `for of` constant.
    fn is_computed_key(&self, file: FileId, index: ExprId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        match hir[index].kind {
            ExprKind::Dot { .. } => true,
            ExprKind::Ident(_) => {
                let symbol = bound.symbol_of_expr(index);
                if symbol.is_none() {
                    return true;
                }
                let symbol = bound.symbol(symbol);
                if !symbol.flags.intersects(SymFlags::VARIABLE) {
                    return true;
                }
                symbol.flags.contains(SymFlags::CONST)
                    && match symbol.decls[..] {
                        [Decl::Var(pat)] => match bound.pat_parent[pat.idx()] {
                            PatParent::Var(d) => hir[d].ty.is_some() || hir[d].init.is_some(),
                            _ => false,
                        },
                        _ => true,
                    }
            }
            _ => false,
        }
    }

    /// Returns the initializer that can make the constant `symbol` a `discriminant_alias`: `x.kind`
    /// in `const k = x.kind`, `x` in `const { kind: k } = x`.
    fn initializer_of_discriminant_alias(&self, file: FileId, symbol: SymbolId) -> Option<ExprId> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if !bound.symbol(symbol).flags.contains(SymFlags::CONST) {
            return None;
        }
        let pat = self.name_of_value_declaration(file, symbol)?;
        let (declaration, is_element) = match bound.pat_parent[pat.idx()] {
            PatParent::Prop(parent_pat, _) | PatParent::Elem(parent_pat, _) => {
                (bound.pat_parent[parent_pat.idx()], true)
            }
            parent => (parent, false),
        };
        let PatParent::Var(d) = declaration else {
            return None;
        };
        let init = hir[d].init;
        let is_candidate = init.is_some()
            && match hir[init].kind {
                ExprKind::Dot { .. } | ExprKind::Index { .. } => true,
                ExprKind::Ident(_) => is_element,
                _ => false,
            };
        is_candidate.then_some(init)
    }

    /// Adds to `about` the root of `e`, an expression that a reference is compared with, along with
    /// everything `matches_prefix` and `optional_chain_contains` visit on their way in. `is_whole`
    /// means `e` is tested as a `discriminant_access`, which a constant can alias:
    /// `const k = x.kind`, `const { kind: k } = x`. `first` is the value to record for the first
    /// property if there is none.
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
        // `at` is the `a` of `a?.b` or of a later link of an optional chain.
        let mut is_link = false;
        loop {
            at = match hir[at].kind {
                ExprKind::Ident(name) => {
                    let symbol = bound.symbol_of_expr(at);
                    if symbol.is_none() {
                        about.add(root_key(Root::Global(name)), first);
                        return;
                    }
                    about.add(root_key(Root::Symbol(symbol)), first);
                    if is_whole
                        && let Some(init) = self.initializer_of_discriminant_alias(file, symbol)
                    {
                        self.note_chain(file, init, false, TestSubjects::NO_PROPERTY, about);
                    }
                    return;
                }
                ExprKind::This => {
                    about.add(root_key(Root::This), first);
                    return;
                }
                ExprKind::Dot {
                    obj, name, chain, ..
                } => {
                    is_whole = false;
                    first = name.0.wrapping_add(1);
                    is_link = chain != Chain::No;
                    obj
                }
                ExprKind::Index { obj, index, chain } => {
                    let resolves = if is_link {
                        ResolvesKey::Always
                    } else {
                        ResolvesKey::ForAccess
                    };
                    if self.is_computed_key(file, index) && about.bails_on_computed_key(resolves) {
                        return;
                    }
                    is_whole = false;
                    first = 0;
                    is_link = chain != Chain::No;
                    obj
                }
                ExprKind::Call(c) if hir[c].chain != Chain::No => {
                    is_whole = false;
                    is_link = true;
                    hir[c].callee
                }
                ExprKind::NonNull(x) | ExprKind::Satisfies { expr: x, .. } => {
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
        if let Parent::Expr(parent) = self.bound(file).parent_of_expr(e) {
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
                    let symbol = bound.symbol_of_expr(e);
                    if symbol.is_some()
                        && bound.symbol(symbol).flags.contains(SymFlags::CONST)
                        && self.is_constant_name(file, symbol)
                        && let Some(pat) = self.name_of_value_declaration(file, symbol)
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
                self.narrow_by_truthiness(reference, ty, e, false, sense)
            }
            ExprKind::Call(_) => self.narrow_by_call(reference, ty, e, sense),
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
                    let in_parentheses = is_parenthesized(hir, target);
                    self.narrow_by_truthiness(reference, ty, target, in_parentheses, sense)
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
                BinOp::And | BinOp::Or => {
                    if sense == (op == BinOp::And) {
                        let ty = self.narrow(reference, ty, left, sense);
                        self.narrow(reference, ty, right, sense)
                    } else {
                        let a = self.narrow(reference, ty, left, sense);
                        let b = self.narrow(reference, ty, right, sense);
                        self.union(&[a, b])
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
        // `narrowType` passes the operand as written, and a parenthesized operand isn't an access.
        if is_parenthesized(self.hir(reference.file), e) {
            return ty;
        }
        if let Some(name) = self.discriminant_access(reference, e, ty) {
            return self.narrow_by_discriminant(ty, name, |c, t| c.type_with_facts(t, include));
        }
        ty
    }

    /// `narrowTypeByTruthiness`. `in_parentheses` means it's called for the
    /// `ParenthesizedExpression` around `e`, which is neither an optional chain nor an access.
    fn narrow_by_truthiness(
        &mut self,
        reference: &Reference,
        ty: TypeId,
        e: ExprId,
        in_parentheses: bool,
        sense: bool,
    ) -> TypeId {
        let include = if sense { facts::TRUTHY } else { facts::FALSY };
        if self.matches(reference, e) {
            return self.adjusted_type_with_facts(ty, include);
        }
        if in_parentheses {
            return ty;
        }
        let mut ty = ty;
        if self.p.files.options.strict_null_checks
            && sense
            && self.optional_chain_contains(reference, e)
        {
            ty = self.non_nullable(ty);
        }
        if let Some(name) = self.discriminant_access(reference, e, ty) {
            return self.narrow_by_discriminant(ty, name, |c, t| c.type_with_facts(t, include));
        }
        ty
    }

    /// `getReferenceCandidate`: the candidate of `x = v`, `x ||= v` and similar is `x`, and that of
    /// `a, x` is `x`. `x!` isn't looked through.
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
        )
        | (
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
        if self.p.files.options.strict_null_checks {
            if self.optional_chain_contains(reference, l) {
                ty = self.narrow_by_optional_chain_containment(file, ty, op, r, sense);
            } else if self.optional_chain_contains(reference, r) {
                ty = self.narrow_by_optional_chain_containment(file, ty, op, l, sense);
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

    /// `narrowTypeByOptionalChainContainment`: `x?.a === v` implies that `x` isn't nullish if `v`
    /// isn't `undefined`, and so does `x?.a !== undefined`.
    fn narrow_by_optional_chain_containment(
        &mut self,
        file: FileId,
        ty: TypeId,
        op: BinOp,
        value: ExprId,
        sense: bool,
    ) -> TypeId {
        let equals_operator = matches!(op, BinOp::EqEq | BinOp::EqEqEq);
        let is_loose = matches!(op, BinOp::EqEq | BinOp::NotEq);
        let nullable = match is_loose {
            true => tf::NULLABLE,
            false => tf::UNDEFINED,
        };
        let value_type = self.get_type_of_expression(file, value);
        let remove_nullable = if equals_operator == sense {
            !self.is_some_type_of_kind(value_type, tf::ANY | tf::UNKNOWN | nullable)
        } else {
            self.is_every_type_of_kind(value_type, nullable)
        };
        if remove_nullable {
            self.adjusted_type_with_facts(ty, facts::NE_UNDEFINED_OR_NULL)
        } else {
            ty
        }
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
            let key = self.get_type_of_expression(file, value);
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

    /// `getKeyPropertyName` and its map (`computeKeyPropertyNameAndMap`). Returns the discriminant
    /// property of the union `ty`'s members, and the member each of its values maps to (UNKNOWN for
    /// a value shared by several members). Returns `None` unless `ty` has at least ten object
    /// types.
    pub(super) fn key_property(
        &mut self,
        ty: TypeId,
    ) -> Option<&'p (Atom, FxHashMap<TypeId, TypeId>)> {
        if !self.is_union(ty) || self.parts(ty).len() < 10 {
            return None;
        }
        let key_property_table = &self.p.key_properties;
        if let Some(known) = key_property_table.get_ref(&self.task, &ty) {
            return known.as_ref();
        }
        let (found, stored) = self.run_memoizable(|c| c.compute_key_property_name_and_map(ty));
        // An incomplete result isn't used. The caller compares with every member of the union
        // instead.
        key_property_table
            .insert_ref(&self.task, ty, found, stored?)
            .1
            .as_ref()
    }

    /// `computeKeyPropertyNameAndMap`
    fn compute_key_property_name_and_map(
        &mut self,
        ty: TypeId,
    ) -> Option<(Atom, FxHashMap<TypeId, TypeId>)> {
        let parts = self.parts(ty);
        let counted = (parts.iter()).filter(|&&m| self.is_object_or_instantiable_non_primitive(m));
        if parts.len() < 10 || counted.count() < 10 {
            return None;
        }
        let name = self.get_key_property_candidate_name(parts)?;
        // `mapTypesByKeyProperty`
        let mut constituents = FxHashMap::with_capacity_and_hasher(parts.len(), Default::default());
        let mut count = 0;
        for &m in parts {
            if !(self.is_object_or_instantiable_non_primitive(m) || self.is_intersection(m)) {
                continue;
            }
            let discriminant = self.type_of_property(m, name)?;
            // `isLiteralType`
            if !self.is_every_type_unit(discriminant) {
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

    /// `isObjectOrInstantiableNonPrimitive`
    fn is_object_or_instantiable_non_primitive(&self, ty: TypeId) -> bool {
        self.is_object_type(ty) || self.flags(ty) & tf::INSTANTIABLE_NON_PRIMITIVE != 0
    }

    /// `getKeyPropertyCandidateName`: the first property whose type is a unit type. It resolves the
    /// type of every property before that one.
    fn get_key_property_candidate_name(&mut self, types: &[TypeId]) -> Option<Atom> {
        for &t in types {
            if !self.is_object_or_instantiable_non_primitive(t) {
                continue;
            }
            let apparent = self.apparent_type(t);
            let Some(members) = self.members(apparent) else {
                continue;
            };
            for prop in &members.shape().props {
                let member_type = self.type_of_prop(prop, members.mapper);
                if self.is_unit(member_type) {
                    return Some(prop.name);
                }
            }
        }
        None
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
            return self.symbol_of_type(source) == self.symbol_of_type(target);
        }
        self.is_subtype(source, target)
    }

    /// `ObjectFlagsClass`: a class's declared type. An instantiation with other type arguments
    /// doesn't count, because `C<any>` is a reference to it.
    fn is_declared_class_type(&mut self, ty: TypeId) -> bool {
        let TypeData::Ref { target, .. } = *self.data(ty) else {
            return false;
        };
        self.files().flags(target).contains(SymFlags::CLASS) && self.declared_type(target) == ty
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
        let operand_type = self.get_type_of_expression(file, value);
        let value_ty = self.regular(operand_type);
        if value_ty == TypeId::UNRESOLVED {
            return ty;
        }
        let key = (ty, operand_type, loose, sense);
        if let Some(&known) = self.flow_memo.equal_types.get(&key) {
            return known;
        }
        let (narrowed, stored) = self
            .run_memoizable(|c| c.narrow_by_equal_type(ty, operand_type, value_ty, loose, sense));
        if stored.is_some() && !self.is_stack_low() {
            self.flow_memo.equal_types.insert(key, narrowed);
        }
        narrowed
    }

    /// Narrows `ty` given whether it's equal (`sense`) to a value of type `operand_type`.
    /// `value_ty` is the same type as an annotation would denote it. `loose` means `==` semantics.
    fn narrow_by_equal_type(
        &mut self,
        ty: TypeId,
        operand_type: TypeId,
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
                    return operand_type;
                }
                if self.is_object_type(value_ty) {
                    return TypeId::OBJECT;
                }
            }
            // `isCoercibleUnderDoubleEquals`
            let coerces = loose
                && (matches!(value_ty, TypeId::NUMBER | TypeId::STRING)
                    || self.is_boolean(value_ty));
            let filtered = self.filter(ty, |c, m| {
                c.are_comparable(m, value_ty)
                    || coerces
                        && (m == TypeId::NUMBER || m == TypeId::STRING || c.is_boolean_like(m))
            });
            // Keeps the freshness of the source literal: a `string` narrowed to `"a"` widens to
            // `string` again where it is stored.
            return self.replace_primitives_with_literals(filtered, operand_type);
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

    /// FOR SPEED: true for a string, number or bigint literal type that isn't an enum member. No
    /// rule of `isSimpleTypeRelatedTo` relates two of them, so they're comparable only if their
    /// regular types are the same. `x.kind !== "a"` tests every member of the type of `x.kind`.
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
        let pattern = tf::TEMPLATE_LITERAL | tf::STRING_MAPPING;
        let primitives = tf::STRING | tf::NUMBER | tf::BIGINT | tf::TEMPLATE_LITERAL;
        let replacements = tf::STRING_LITERAL | tf::NUMBER_LITERAL | tf::BIGINT_LITERAL | pattern;
        if !self.maybe_type_of_kind(ty, primitives)
            || !self.maybe_type_of_kind(literals, replacements)
        {
            return ty;
        }
        let has_wide_strings = self.maybe_type_of_kind(literals, tf::STRING | pattern);
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
            if self.p.files.options.strict_null_checks
                && self.optional_chain_contains(reference, operand)
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
            known::undefined => self.narrow_type_by_type_facts(ty, TypeId::UNDEFINED, EQ_UNDEFINED),
            known::object => {
                if self.has_any_flag(ty) {
                    return ty;
                }
                let object = self.narrow_type_by_type_facts(ty, TypeId::OBJECT, TYPEOF_EQ_OBJECT);
                let null = self.narrow_type_by_type_facts(ty, TypeId::NULL, EQ_NULL);
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

    /// `getEffectsSignature` for `e`, which is `left instanceof right`. `right_type` is `right`'s
    /// type, which only the first evaluation reads.
    pub(super) fn effects_signature_of_instanceof(
        &mut self,
        file: FileId,
        e: ExprId,
        right_type: TypeId,
    ) -> Option<SigId> {
        if let Some(known) = self.p.effects_signatures.get(&self.task, &(file, e)) {
            return known;
        }
        let begun = self.begin_effects_signature();
        let mut required_resolution = false;
        let sig = match self.symbol_has_instance_method_of_object_type(right_type) {
            Some(method) => {
                self.effects_signature_of_function_type(file, e, method, &mut required_resolution)
            }
            None => None,
        };
        self.assign_effects_signature(file, e, sig, begun, required_resolution);
        sig
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
            if sense
                && self.p.files.options.strict_null_checks
                && self.optional_chain_contains(reference, left)
            {
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
                ..
            }) = self.sig_predicate(sig)
        {
            return self.narrowed_to(ty, guarded, sense, CheckDerived::Yes);
        }
        let function = self.global_ref(known::Function, &[]);
        if !self.is_type_derived_from(constructor, function) {
            return ty;
        }
        let instance = self.map_type(constructor, |c, m| c.instance_type(m));
        // `any` isn't narrowed to `Object` or `Function`. The false branch narrows only if the
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
        if let Some(prototype) = self.type_of_property_of_type(constructor, known::prototype)
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
        if self.is_reference_to_global(target, known::Object, 0) {
            return is_object && !self.is_empty_anonymous_object_type(source);
        }
        if self.is_reference_to_global(target, known::Function, 0) {
            return self.is_object_type(source) && self.is_function_object_type(source);
        }
        let base = match *self.data(target) {
            TypeData::Ref { target: base, .. } => base,
            TypeData::Tuple { .. } => return self.has_tuple_base(source, target),
            _ => return false,
        };
        if self.has_base(source, base) {
            return true;
        }
        if self.is_reference_to_global(target, known::Array, 1) {
            let readonly = self.readonly_array_of(TypeId::ANY);
            return self.is_type_derived_from(source, readonly);
        }
        false
    }

    /// `hasBaseType(ty, getTargetType(tuple))`. The tuple types with the same element flags, labels
    /// and `readonly` share a target (`getTupleTargetType`). The base type of a tuple target is an
    /// array type, which has no tuple type as a base type.
    fn has_tuple_base(&mut self, ty: TypeId, tuple: TypeId) -> bool {
        match (self.data(ty), self.data(tuple)) {
            (TypeData::Ref { target, .. }, _) => self
                .base_types(*target)
                .iter()
                .any(|&base| self.has_tuple_base(base, tuple)),
            (
                TypeData::Tuple {
                    flags, readonly, ..
                },
                TypeData::Tuple {
                    flags: check_flags,
                    readonly: check_readonly,
                    ..
                },
            ) => flags[..] == check_flags[..] && readonly == check_readonly,
            (TypeData::Intersection(parts), _) => {
                parts.iter().any(|&part| self.has_tuple_base(part, tuple))
            }
            _ => false,
        }
    }

    /// `getNarrowedType`. Narrows `ty`, knowing that the value is (or isn't) a `candidate`.
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
            let ty = if ty == TypeId::UNKNOWN {
                self.unknown_union_type()
            } else {
                ty
            };
            let true_branch_type = self.narrowed_to(ty, candidate, true, CheckDerived::No);
            let rest = self.filter(ty, |c, m| {
                !(m == true_branch_type || c.parts(true_branch_type).contains(&m))
            });
            return self.recombine_unknown_type(rest);
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
            // Of two related types, pick the more specific one. If each is related to the other,
            // pick the candidate for a type guard and the original type for `instanceof`, since a
            // prototype carries no type arguments.
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
                if c.maybe_type_of_kind(t, tf::INSTANTIABLE) {
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

    /// `narrowTypeByBinaryExpression` for `left in right`.
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
        if let ExprKind::PrivateIdentifier(name) = hir[left].kind
            && !is_parenthesized(hir, left)
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
        if reference.accesses != 0
            && self.contains_missing_type(ty)
            && self.matches_prefix(reference, reference.path.len() - 1, right, false)
        {
            let key = self.get_type_of_expression(file, left);
            if let Some(key) = self.property_name_of_type(key)
                && self.name_of_step(reference, reference.path.len() - 1) == Some(key)
            {
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
            // `any` declares no properties, so the result is the intersection with
            // `Record<K, unknown>` below, which is `errorType` for an error type and `anyType` for
            // `autoType`.
            let is_intersected = sense
                && self
                    .get_global_type_alias_symbol(known::Record, 2, true)
                    .is_some();
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
        // No member declares the property. In the true branch, all we know is that it's present.
        if sense && let Some(record) = self.get_global_type_alias_symbol(known::Record, 2, true) {
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
        if reference.accesses != 0
            && self.contains_missing_type(ty)
            && let ExprKind::Call(c) = hir[call].kind
            && let ExprKind::Dot { obj, name, .. } = hir[hir[c].callee].kind
            && !is_parenthesized(hir, hir[c].callee)
        {
            let obj = self.reference_candidate(file, obj);
            if self.matches_prefix(reference, reference.path.len() - 1, obj, false)
                && self.atoms().bytes(name) == b"hasOwnProperty"
                && hir[c].args.len() == 1
                && let Some(last) = self.name_of_step(reference, reference.path.len() - 1)
                && let ExprKind::String(text) = hir[hir.id_at(hir[c].args, 0)].kind
                && !is_parenthesized(hir, hir.id_at(hir[c].args, 0))
                && text == last
            {
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

    /// Narrows the reference by `call` if the callee is a type guard that applies to it. Returns
    /// `None` otherwise.
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
        if !self.has_matching_argument(reference, c) || !sense && data.chain != Chain::No {
            return None;
        }
        let sig = match hir[data.callee].kind {
            // `checkPropertyAccessExpression` of a member of the reference being narrowed: the type
            // of the object is already available here, and querying it would re-enter.
            ExprKind::Dot { obj, name, .. } if self.matches(reference, obj) => {
                // `links.effectsSignature`: only the first evaluation takes the type of this walk.
                let known = self.p.effects_signatures.get(&self.task, &(file, call));
                match known {
                    Some(known) => known?,
                    None => {
                        let begun = self.begin_effects_signature();
                        let mut required_resolution = false;
                        let receiver = self.non_nullable(ty);
                        let declared = self.type_of_property(receiver, name);
                        let sig = match declared {
                            Some(declared) if !self.is_any(declared) => {
                                let prop = self
                                    .get_property_of_type(receiver, name)
                                    .map(|found| found.0);
                                let right = (file, hir.name_pos(data.callee), hir[data.callee].end);
                                let target = self.target_kind(file, data.callee);
                                let mut callee = self.get_flow_type_of_access_expression(
                                    file,
                                    data.callee,
                                    prop,
                                    declared,
                                    right,
                                    target,
                                );
                                // `getOptionalExpressionType`
                                if data.chain == Chain::Start {
                                    callee = self.non_nullable(callee);
                                }
                                let callee = self.check_non_null_type(file, data.callee, callee);
                                self.effects_signature_of_function_type(
                                    file,
                                    call,
                                    callee,
                                    &mut required_resolution,
                                )
                            }
                            _ => None,
                        };
                        self.assign_effects_signature(file, call, sig, begun, required_resolution);
                        sig?
                    }
                }
            }
            _ => self.effects_signature(file, call)?,
        };
        let predicate = self.sig_predicate(sig)?;
        if predicate.asserts {
            return None;
        }
        Some(self.apply_predicate(reference, ty, predicate, c, sense))
    }

    /// `hasMatchingArgument`
    fn has_matching_argument(&mut self, reference: &Reference, c: CallId) -> bool {
        let hir = self.hir(reference.file);
        for argument in hir.ids(hir[c].args) {
            if self.is_or_contains_matching_reference(reference, argument)
                || !is_parenthesized(hir, argument)
                    && self.optional_chain_contains(reference, argument)
            {
                return true;
            }
        }
        let callee = hir[c].callee;
        matches!(hir[callee].kind, ExprKind::Dot { obj, .. }
            if !is_parenthesized(hir, callee)
                && self.is_or_contains_matching_reference(reference, obj))
    }

    /// `getTypePredicateArgument`
    fn get_type_predicate_argument(
        &self,
        file: FileId,
        predicate: Predicate,
        c: CallId,
    ) -> Option<ExprId> {
        let hir = self.hir(file);
        match predicate.param {
            Some(i) => hir.ids(hir[c].args).nth(i),
            None => match hir[hir[c].callee].kind {
                ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => Some(obj),
                _ => None,
            },
        }
    }

    fn apply_predicate(
        &mut self,
        reference: &Reference,
        ty: TypeId,
        predicate: Predicate,
        c: CallId,
        sense: bool,
    ) -> TypeId {
        let Some(subject) = self.get_type_predicate_argument(reference.file, predicate, c) else {
            return ty;
        };
        match predicate.ty {
            // `narrowTypeByTypePredicate`
            Some(target) => {
                // `any` isn't narrowed to exactly `Object` or `Function`.
                if self.is_any(ty)
                    && (self.is_reference_to_global(target, known::Object, 0)
                        || self.is_reference_to_global(target, known::Function, 0))
                {
                    return ty;
                }
                if self.matches(reference, subject) {
                    return self.narrowed_to(ty, target, sense, CheckDerived::No);
                }
                // The receiver is taken without its parentheses, but an argument is taken as
                // written, and a parenthesized argument is neither an optional chain nor an access.
                if predicate.param.is_some() && is_parenthesized(self.hir(reference.file), subject)
                {
                    return ty;
                }
                // A short-circuited chain yields `undefined`. This one completed if its result is
                // of a type that excludes `undefined`, or isn't of a type that consists only of
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
            // `getTypeAtFlowCall`: `asserts x`. `asserts this` narrows nothing.
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
            _ => self.narrow(reference, ty, e, true),
        }
    }

    /// True if `call`, whose effects signature is `sig`, is like `assert(false)`: no code after it
    /// is reachable, and `narrowTypeByAssertion` gives every reference a `never` type.
    fn asserts_false_expression(&mut self, file: FileId, call: ExprId, sig: SigId) -> bool {
        let hir = self.hir(file);
        if let Some(Predicate {
            param: Some(i),
            ty: None,
            asserts: true,
            ..
        }) = self.sig_predicate(sig)
            && let ExprKind::Call(c) = hir[call].kind
            && let Some(asserted) = hir.ids(hir[c].args).nth(i)
        {
            return self.is_false_expression(file, asserted);
        }
        false
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
        from: u32,
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
        let (from, to) = entered_clauses(hir, cases, from);
        if self.matches(reference, subject) {
            return self.narrow_by_switch_values(file, ty, stmt, from, to);
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
            // `typeof x?.a` is `"undefined"` if the chain short-circuits. A parenthesized chain
            // isn't a chain.
            if strict
                && !is_parenthesized(hir, operand)
                && self.optional_chain_contains(reference, operand)
            {
                return self.narrow_by_switch_optional_chain_containment(file, ty, stmt, from, to, |c, t| {
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
                stmt,
                from,
                to,
                |_, t| !t.is_undefined() && !t.is_never(),
            );
        }
        if let Some(access) = self.discriminant_access(reference, subject, ty) {
            return self
                .narrow_by_switch_on_discriminant_property(file, ty, access, stmt, from, to);
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
        stmt: StmtId,
        from: usize,
        to: usize,
        check: impl Fn(&Self, TypeId) -> bool,
    ) -> TypeId {
        if from == to {
            return ty;
        }
        let switch_types = self.get_switch_clause_types(file, stmt);
        if !switch_types[from..to].iter().all(|&t| check(self, t)) {
            return ty;
        }
        self.type_with_facts(ty, facts::NE_UNDEFINED_OR_NULL)
    }

    /// `narrowTypeBySwitchOnDiscriminantProperty`
    fn narrow_by_switch_on_discriminant_property(
        &mut self,
        file: FileId,
        ty: TypeId,
        access: Access,
        stmt: StmtId,
        from: usize,
        to: usize,
    ) -> TypeId {
        if from < to
            && let Some((name, constituents)) = self.key_property(ty)
            && *name == access.name
        {
            let switch_types = self.get_switch_clause_types(file, stmt);
            let mut candidates = Vec::with_capacity(to - from);
            // `default` maps to no member, and neither does a value shared by several members, so
            // fall back to the general path.
            for key in &switch_types[from..to] {
                match constituents.get(key) {
                    Some(&candidate) if candidate != TypeId::UNKNOWN => candidates.push(candidate),
                    _ => break,
                }
            }
            if candidates.len() == to - from {
                return self.union(&candidates);
            }
        }
        self.narrow_by_discriminant(ty, access, |c, t| {
            c.narrow_by_switch_values(file, t, stmt, from, to)
        })
    }

    /// `narrowTypeBySwitchOnDiscriminant`
    fn narrow_by_switch_values(
        &mut self,
        file: FileId,
        ty: TypeId,
        stmt: StmtId,
        from: usize,
        to: usize,
    ) -> TypeId {
        let switch_types = self.get_switch_clause_types(file, stmt);
        if switch_types.is_empty() {
            return ty;
        }
        let clause_types = &switch_types[from..to];
        let has_default = from == to || clause_types.contains(&TypeId::NEVER);
        if ty == TypeId::UNKNOWN && !has_default {
            // An object type among the cases only shows that the value is an object, not which one.
            let mut ground = Vec::with_capacity(clause_types.len());
            for &t in clause_types {
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
        let discriminant = self.union(clause_types);
        let case_type = if discriminant.is_never() {
            TypeId::NEVER
        } else {
            let filtered = self.filter(ty, |c, m| c.are_comparable(discriminant, m));
            self.replace_primitives_with_literals(filtered, discriminant)
        };
        if !has_default {
            return case_type;
        }
        // A unit type is removed if a case may have that value: `"a"` for `case E.a`, if `E.a` has
        // that value.
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
            !(c.is_unit(unit) && switch_types.contains(&unit)
                || switch_types
                    .iter()
                    .any(|&t| c.is_unit(t) && c.are_comparable(t, unit)))
        });
        if case_type.is_never() {
            return default_type;
        }
        self.union(&[case_type, default_type])
    }

    /// `getSwitchClauseTypes`: `getTypeOfSwitchClause` of every clause, which is `never` for
    /// `default`.
    fn get_switch_clause_types(&mut self, file: FileId, stmt: StmtId) -> std::rc::Rc<[TypeId]> {
        let links = self.flow_memo.switch_statement_links.get(&(file, stmt));
        if let Some(switch_types) = links.and_then(|links| links.switch_types.as_ref()) {
            return std::rc::Rc::clone(switch_types);
        }
        let hir = self.hir(file);
        let StmtKind::Switch { cases, .. } = hir[stmt].kind else {
            return std::rc::Rc::default();
        };
        let mut types = Vec::with_capacity(cases.len());
        for clause in cases.iter() {
            let test = hir[clause].test;
            types.push(if test.is_none() {
                TypeId::NEVER
            } else {
                let ty = self.get_type_of_expression(file, test);
                self.regular(ty)
            });
        }
        let types: std::rc::Rc<[TypeId]> = types.into();
        // `UNRESOLVED` means a query was rejected, which never happens in tsgo.
        if !types.contains(&TypeId::UNRESOLVED) {
            let links = self.flow_memo.switch_statement_links.entry((file, stmt));
            links.or_default().switch_types = Some(std::rc::Rc::clone(&types));
        }
        types
    }

    /// `getSwitchClauseTypeOfWitnesses`. Returns the `typeof` name each clause tests for, with
    /// `Atom::NONE` for `default`, for `""` and for a name an earlier clause already has. Returns
    /// `None` if some clause's expression isn't a string literal, or is a parenthesized one.
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
            // Keep whatever no other clause matches.
            let not_equal = not_equal_facts_from_typeof_switch(&witnesses, from, to);
            return self.filter(ty, |c, m| c.type_facts(m, not_equal) == not_equal);
        }
        let mut entered = Vec::with_capacity(to - from);
        for &name in &witnesses[from..to] {
            entered.push(if name.is_some() {
                self.narrow_type_by_typeof_name(ty, name, true)
            } else {
                TypeId::NEVER
            });
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
        !self.maybe_type_of_kind(constraint, tf::NULLABLE)
    }

    /// `isConstraintPosition`. True if `e` is in a position where its type's constraint is what
    /// matters: `e.x`, `e[x]`, `e()`, `new e()`. In `(e).x`, `e`'s parent is the parenthesized
    /// expression.
    fn is_constraint_position(&mut self, file: FileId, e: ExprId, ty: TypeId) -> bool {
        let hir = self.hir(file);
        let Parent::Expr(parent) = self.bound(file).parent_of_expr(e) else {
            return false;
        };
        if is_parenthesized(hir, e) {
            return false;
        }
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
                !self.is_generic_index_type(index)
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
        if let Some(frame) = self.frames.last_mut() {
            frame.may_substitute_constraints = true;
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
        self.map_type(declared, |c, m| c.base_constraint_or_type(m))
    }

    /// The end of `checkIdentifier`, from `getNarrowableTypeForReference` on. Reports 7034, 7005
    /// and 2454. `sym` is the symbol `e` resolves to.
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
        let crossing = self.crossing_of_identifier(file, e, sym, declared);
        // FOR SPEED: `assumeInitialized` is evaluated when the walk needs it.
        let ty = self.flow_type_of(file, e, declared, Start::Unsettled, crossing);
        let hir = self.hir(file);
        if self.is_automatic_type(declared) && !self.is_evolving_array_operation_target(file, e) {
            // These types only occur under `noImplicitAny`. `checkWithStatement` doesn't check the
            // body.
            if self.is_automatic_type(ty) && !hir.is_in_with(hir[e].pos) {
                let args = [Arg::Sym(sym), Arg::Type(ty)];
                if let Some(name) = self.span_of_symbol(sym) {
                    self.error_at(name, 7034, &args);
                }
                self.error_at(self.span_of_token(file, hir[e].pos), 7005, &args);
            }
            return self.convert_auto_to_any(ty);
        }
        if ty != declared
            && self.contains_undefined(ty)
            && !self.contains_undefined(declared)
            && !self.assumes_initialized(file, e, declared)
        {
            self.error_at(self.span_of_token(file, hir[e].pos), 2454, &[Arg::Sym(sym)]);
            // "Return the declared type to reduce follow-on errors"
            return declared;
        }
        ty
    }

    /// `getFlowTypeOfReference(e, declared)`
    pub(super) fn flow_type_of_reference(
        &mut self,
        file: FileId,
        e: ExprId,
        declared: TypeId,
    ) -> TypeId {
        if declared == TypeId::UNRESOLVED || declared.is_never() {
            return declared;
        }
        self.flow_type_of(file, e, declared, Start::Known, Crossing::No)
    }

    /// `getFlowTypeOfAccessExpression`, except for a property whose type is `autoType`. `prop` is
    /// `None` for an access resolved through an index signature. `error_node` is the name or the
    /// index. `target` is `e`'s `target_kind`.
    pub(super) fn get_flow_type_of_access_expression(
        &mut self,
        file: FileId,
        e: ExprId,
        prop: Option<&Prop>,
        prop_type: TypeId,
        error_node: FileSpan,
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
        let flow_type = self.flow_type_of(file, e, prop_type, start, Crossing::No);
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
            // of the three. A recreated symbol is a property, even if the original isn't.
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

    /// `getFlowTypeOfAccessExpression`'s `assumeUninitialized`, for the access `e` to `prop`.
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
            |x: ExprId| self.get_control_flow_container(file, bound.parent_of_expr(x));
        // `prop.ValueDeclaration`, if it is an assignment.
        let (decl_file, assignment) = match self.value_declaration_of_prop(prop) {
            Some((decl_file, Decl::Member(m))) => {
                let (ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. }) = hir[e].kind else {
                    return false;
                };
                let MemberOwner::Class(class) = self.bound(decl_file).member_owner[m.idx()] else {
                    return false;
                };
                let member = &self.hir(decl_file)[m];
                return options.strict_property_initialization
                    && decl_file == file
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
            // `exports.name = value` declares a variable. An alias declaration isn't a value
            // declaration; `Object.defineProperty(exports, "name", descriptor)` is one.
            Some((
                decl_file,
                Decl::Expando(first) | Decl::ThisProperty(first) | Decl::ExportsProperty(first),
            )) => (decl_file, first),
            _ => return false,
        };
        decl_file == file
            // The left side of `f[key] = value` isn't a property access.
            && matches!(hir[assignment].kind, ExprKind::Assign { target, .. }
                if matches!(hir[target].kind, ExprKind::Dot { .. }))
            && container_of(e) == container_of(assignment)
    }

    /// `checkDeclarationInitializer(declaration, CheckModeRestBindingElement,
    /// nil)`, before it pads the type. `e` is the initializer of a variable or parameter declared
    /// by a binding pattern without a type annotation, and the type is for the pattern's `...rest`.
    /// Under that mode `checkExpressionCachedEx` doesn't assign `links.resolvedType` or touch
    /// `flowLoopStack`.
    pub(super) fn check_declaration_initializer_for_rest(
        &mut self,
        file: FileId,
        e: ExprId,
    ) -> TypeId {
        match self.quick_type_of_expr(file, e) {
            Some(quick) => quick,
            None => self.check_expression_cached_ex(file, e, CheckMode::REST_BINDING_ELEMENT),
        }
    }

    /// True if `e` is the `x` in `x!`. `(x)!` doesn't count, because only the direct syntactic
    /// parent does.
    #[inline(always)]
    fn is_operand_of_non_null(&self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        matches!(self.bound(file).parent_of_expr(e), Parent::Expr(parent) if matches!(hir[parent].kind, ExprKind::NonNull(_)))
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
        // `checkDeclarationInitializer`. The initializer may be the expression being checked, which
        // `type_of_declaration_initializer` would enter again before it requests the quick type.
        let initializer = self.hir(file)[p].default;
        let default = self
            .quick_type_of_expr(file, initializer)
            .unwrap_or_else(|| self.type_of_expr(file, initializer));
        // `any` doesn't have the fact. An `UNRESOLVED` type might.
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
        self.function_or_module_block_of_node(file, self.hir(file).node(e))
    }

    /// `FindAncestor(node, IsFunctionOrModuleBlock)`
    fn function_or_module_block_of_node(&self, file: FileId, node: Node) -> Node {
        let hir = self.hir(file);
        hir.find_ancestor(node, |n| match hir.kind(n) {
            Kind::SourceFile | Kind::ModuleBlock => true,
            Kind::Block => hir.kind(hir.parent(n)).is_function_like(),
            _ => false,
        })
    }

    /// `reportFlowControlError(f.reference)`. `check_flow_too_deep` reports 2563 from the tables.
    fn report_flow_control_error(&self, reference: &Reference) {
        let file = reference.file;
        match reference.at.some() {
            Some(e) => (self.p.flows_too_deep).insert(&self.task, (file, e), (), Stored::new()),
            None => {
                let block = self.function_or_module_block_of_node(file, reference.node);
                let blocks = &self.p.blocks_too_large_for_flow_analysis;
                blocks.insert(&self.task, (file, block), (), Stored::new());
            }
        }
    }

    /// Not in tsgo. Indexes the symbols of `file` that some node of its flow graph refers to: a
    /// condition (`note_test`, as for `is_test_about`), a `switch`, an assignment target, a
    /// `for in` expression. Nothing else can change the type of a reference rooted at a name,
    /// except an assertion call (see `FlowMemo::in_call_statements`). The index is left empty if
    /// some backward path through the graph may take `MAX_FLOW_DEPTH` invocations, because the walk
    /// that detects that has to report it. The same nodes resolve the names of keys
    /// (`FlowMemo::computed_key_nodes`).
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
        let mut lowest = vec![0u32; bound.flow.len()];
        let mut computed_key_nodes = Vec::new();
        let mut finally_blocks = Vec::new();
        let mut union_nodes = Vec::new();
        let mut noted_switches: FxHashMap<StmtId, (ResolvesKey, bool)> = FxHashMap::default();
        let mut longest = 0;
        for (i, &node) in bound.flow.iter().enumerate() {
            let about =
                &mut FirstNarrowingNodes(&mut first_nodes, i as u32, ResolvesKey::Never, false);
            let mut resolves_in_call = ResolvesKey::Never;
            let mut builds_union = false;
            let before = node.antecedents(&bound.flow_edges);
            // A function start and a declaration (except a `for in`'s) don't add a
            // `getTypeAtFlowNode` invocation, because its loop just continues to the antecedent.
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
                        && matches!(bound.parent_of_stmt(stmt), Parent::Stmt(owner)
                            if matches!(hir[owner].kind, StmtKind::ForIn { .. }));
                    u32::from(is_of_for_in)
                }
                _ => 1,
            };
            (highest[i], lowest[i], lengths[i]) = (i as u32, i as u32, 1);
            let is_start = matches!(node, Flow::Start { .. } | Flow::StartInvoked { .. });
            for before in before.iter().filter(|before| before.is_some()) {
                highest[i] = highest[i].max(before.0).max(highest[before.idx()]);
                if !is_start && before.idx() < i {
                    lowest[i] = lowest[i].min(lowest[before.idx()]);
                }
                // 0 for the back edge of a loop, which has a higher number.
                lengths[i] = lengths[i].max(lengths[before.idx()] + invocations);
            }
            longest = longest.max(lengths[i]);
            match node {
                Flow::Cond { expr, .. } => self.note_test(file, expr, 0, about),
                Flow::Switch { stmt, from, .. } => {
                    if let StmtKind::Switch { expr, cases } = hir[stmt].kind {
                        // Every node of a `switch` has the same subjects, and `first_nodes` only keeps
                        // the lowest node number.
                        if let Some(&(resolves, has_union)) = noted_switches.get(&stmt) {
                            (about.2, about.3) = (resolves, has_union);
                        } else {
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
                            noted_switches.insert(stmt, (about.2, about.3));
                        }
                        // `narrowTypeBySwitchOnTrue` returns the union of its clauses' results.
                        builds_union = matches!(hir[expr].kind, ExprKind::True) && {
                            let (from, to) = entered_clauses(hir, cases, from);
                            about.3 || to - from > 1
                        };
                    }
                }
                Flow::Assign { target, .. } => match target {
                    FlowTarget::Expr(e) => {
                        self.note_chain(file, e, false, TestSubjects::NO_PROPERTY, about)
                    }
                    FlowTarget::Var(d) => {
                        if let Some(at) =
                            declaration_node.get_mut(bound.pat_symbol[hir[d].pat.idx()].idx())
                        {
                            *at = i as u32;
                        }
                        let stmt = bound.var_stmt[d.idx()];
                        if stmt.is_some()
                            && let Parent::Stmt(owner) = bound.parent_of_stmt(stmt)
                            && let StmtKind::ForIn { left, expr, .. } = hir[owner].kind
                            && left == stmt
                        {
                            self.note_chain(file, expr, false, TestSubjects::NO_PROPERTY, about);
                        }
                    }
                    FlowTarget::Pat(p) => {
                        if let Some(at) = declaration_node.get_mut(bound.pat_symbol[p.idx()].idx())
                        {
                            *at = i as u32;
                        }
                    }
                },
                // For `asserts x` the argument is a condition. `asserts x is T` narrows an argument
                // and `asserts this` the receiver.
                Flow::Call { call, .. } => {
                    if let ExprKind::Call(c) = hir[call].kind {
                        let about = &mut CallStatementSubjects(
                            &mut last_call_statement,
                            i as u32,
                            &mut call_statements_by_symbol,
                            ResolvesKey::Never,
                            false,
                        );
                        self.note_test(file, call, 0, about);
                        for argument in hir.ids(hir[c].args) {
                            self.note_asserted(file, argument, about);
                        }
                        (resolves_in_call, builds_union) = (about.3, about.4);
                    }
                }
                Flow::Reduce { label, .. } => finally_blocks.push((label.0, i as u32)),
                _ => {}
            }
            let resolves = about.2.max(resolves_in_call);
            if resolves != ResolvesKey::Never {
                computed_key_nodes.push((i as u32, resolves));
            }
            if builds_union {
                union_nodes.push(i as u32);
            }
        }
        if longest >= MAX_FLOW_DEPTH {
            first_nodes.clear();
        }
        for &(symbol, _) in &call_statements_by_symbol {
            mentioned_in_calls[symbol.idx() / 64] |= 1 << (symbol.idx() % 64);
        }
        call_statements_by_symbol.shared_sort_unstable_by_key(|&(symbol, flow)| (symbol.0, flow.0));
        let memo = &mut self.flow_memo;
        memo.narrowing_index_file = Some(file);
        (
            memo.first_narrowing_node,
            memo.in_call_statements,
            memo.call_statements_by_symbol,
        ) = (first_nodes, mentioned_in_calls, call_statements_by_symbol);
        (memo.max_antecedent, memo.declaration_node) = (highest, declaration_node);
        (memo.min_antecedent, memo.computed_key_nodes) = (lowest, computed_key_nodes);
        memo.union_nodes = union_nodes;
        memo.finally_blocks = finally_blocks;
        for calls in [
            &mut memo.unsettled_call_before,
            &mut memo.unsettled_call_on_first_path,
        ] {
            calls.clear();
            calls.resize(bound.flow.len(), u32::MAX);
        }
        memo.stopping_calls.clear();
        memo.stopping_calls.resize(bound.flow.len() / 64 + 1, 0);
    }

    /// Not in tsgo. Returns the first node at which a walk back from `flow` evaluates something,
    /// given that its reference is never narrowed or assigned and starts with its declared type.
    /// Such a walk takes the first reachable antecedent at a join. The node is either a call
    /// statement with no entry in `effects_signatures`, where the walk evaluates
    /// `getEffectsSignature` and so resolves types, or a node past which this function doesn't
    /// follow the walk. Returns 0 if there's no such node, `NEVER_RETURNS` if there's none and the
    /// walk ends at a call that never returns, and `u32::MAX` if it isn't known.
    fn first_unsettled_call(&mut self, file: FileId, flow: FlowId) -> u32 {
        let bound = self.bound(file);
        let mut passed: SmallVec<[FlowId; 16]> = SmallVec::new();
        let mut at = flow;
        let found = loop {
            let known = self.flow_memo.unsettled_call_on_first_path[at.idx()];
            if self.flow_memo.is_up_to_date(file, known) {
                break known;
            }
            passed.push(at);
            at = match bound.flow[at.idx()] {
                Flow::Unreachable => break 0,
                Flow::Call { before, call } => {
                    if !self.flow_memo.is_settled_call(file, at) {
                        break at.0;
                    }
                    // `getTypeAtFlowCall`
                    if !self.flow_memo.is_idle_call(file, at)
                        && let Some(sig) = self.effects_signature(file, call)
                    {
                        if self.flow_memo.builds_union(at)
                            || self.asserts_false_expression(file, call, sig)
                        {
                            self.flow_memo.stopping_calls[at.idx() / 64] |= 1 << (at.idx() % 64);
                            break at.0;
                        }
                        if !matches!(self.sig_predicate(sig), Some(p) if p.asserts)
                            && self.sig_return(sig).is_never()
                        {
                            break NEVER_RETURNS;
                        }
                    }
                    before
                }
                Flow::Switch { .. } if self.flow_memo.builds_union(at) => break at.0,
                Flow::Start { outer: before, .. }
                | Flow::StartInvoked { outer: before, .. }
                | Flow::ArrayMutation { before, .. }
                | Flow::Cond { before, .. }
                | Flow::Switch { before, .. }
                | Flow::Assign { before, .. } => before,
                Flow::Reduce { .. } => break at.0,
                Flow::Loop { .. } if self.flow_memo.is_in_finally_block(at) => break at.0,
                Flow::Label { start, len } | Flow::Loop { start, len } => {
                    if self.is_stack_low() {
                        return u32::MAX;
                    }
                    let is_loop = matches!(bound.flow[at.idx()], Flow::Loop { .. });
                    let mut antecedents = bound.edges(start, len).iter();
                    let mut found = NEVER_RETURNS;
                    let mut has_bypass = false;
                    while found == NEVER_RETURNS
                        && let Some(&edge) = antecedents.next()
                    {
                        if !is_loop && !has_bypass && bound.flow[edge.idx()].enters_no_clause() {
                            has_bypass = true;
                            continue;
                        }
                        found = self.first_unsettled_call(file, edge);
                        // The back edges are followed only if the entry is unreachable.
                        if is_loop {
                            break;
                        }
                    }
                    match found {
                        u32::MAX => return found,
                        NEVER_RETURNS if is_loop || has_bypass => break at.0,
                        _ => break found,
                    }
                }
            };
            if at.is_none() {
                break 0;
            }
        };
        for at in passed {
            self.flow_memo.unsettled_call_on_first_path[at.idx()] = found;
        }
        found
    }

    /// Not in tsgo. `first_unsettled_call` for a walk that takes every antecedent of a join, which
    /// a walk does if it doesn't start with the declared type. Returns the highest-numbered such
    /// call statement. An antecedent has a lower number than its node, except on a loop's back
    /// edge. Returns `NEVER_RETURNS` if there's none and every path ends at a call that never
    /// returns.
    fn highest_unsettled_call(&mut self, file: FileId, flow: FlowId) -> u32 {
        let bound = self.bound(file);
        let mut passed: SmallVec<[FlowId; 16]> = SmallVec::new();
        // The index in `passed` of the last loop label with a back edge.
        let mut last_loop = None;
        let mut at = flow;
        let mut found = loop {
            let known = self.flow_memo.unsettled_call_before[at.idx()];
            if self.flow_memo.is_up_to_date(file, known) {
                break known;
            }
            passed.push(at);
            at = match bound.flow[at.idx()] {
                Flow::Unreachable => break 0,
                Flow::Call { .. } if !self.flow_memo.is_settled_call(file, at) => break at.0,
                Flow::Call { before, call } => {
                    // `getTypeAtFlowCall`
                    if !self.flow_memo.is_idle_call(file, at)
                        && let Some(sig) = self.effects_signature(file, call)
                    {
                        if self.flow_memo.builds_union(at)
                            || self.asserts_false_expression(file, call, sig)
                        {
                            self.flow_memo.stopping_calls[at.idx() / 64] |= 1 << (at.idx() % 64);
                            break at.0;
                        }
                        if !matches!(self.sig_predicate(sig), Some(p) if p.asserts)
                            && self.sig_return(sig).is_never()
                        {
                            break NEVER_RETURNS;
                        }
                    }
                    before
                }
                Flow::Switch { .. } if self.flow_memo.builds_union(at) => break at.0,
                Flow::Start { outer: before, .. }
                | Flow::StartInvoked { outer: before, .. }
                | Flow::ArrayMutation { before, .. }
                | Flow::Cond { before, .. }
                | Flow::Switch { before, .. }
                | Flow::Assign { before, .. } => before,
                // The walk passes the `finally` block, whose label then has only `instead`'s
                // antecedents.
                Flow::Reduce {
                    before, instead, ..
                } => {
                    if self.is_stack_low() {
                        return u32::MAX;
                    }
                    let in_block = self.highest_unsettled_call(file, before);
                    match (in_block, self.highest_unsettled_call(file, instead)) {
                        (u32::MAX, _) | (_, u32::MAX) => return u32::MAX,
                        (0, NEVER_RETURNS) => break NEVER_RETURNS,
                        _ => break in_block,
                    }
                }
                Flow::Loop { .. } if self.flow_memo.is_in_finally_block(at) => break at.0,
                // If the type at the entry is the declared type, no back edge is followed.
                Flow::Loop { start, len } => match *bound.edges(start, len) {
                    [] => break 0,
                    [entry] => entry,
                    [entry, ..] => {
                        last_loop = Some(passed.len() - 1);
                        entry
                    }
                },
                Flow::Label { start, len } => {
                    if self.is_stack_low() {
                        return u32::MAX;
                    }
                    let (mut highest, mut is_reached, mut bypass) = (0, false, None);
                    for &edge in bound.edges(start, len) {
                        if bypass.is_none() && bound.flow[edge.idx()].enters_no_clause() {
                            bypass = Some(edge);
                            continue;
                        }
                        match self.highest_unsettled_call(file, edge) {
                            u32::MAX => return u32::MAX,
                            NEVER_RETURNS => {}
                            found => {
                                is_reached = true;
                                highest = highest.max(found);
                            }
                        }
                    }
                    match bypass.map(|edge| self.highest_unsettled_call(file, edge)) {
                        Some(u32::MAX) => return u32::MAX,
                        None | Some(NEVER_RETURNS) if is_reached => break highest,
                        None | Some(NEVER_RETURNS) => break NEVER_RETURNS,
                        Some(found) if is_reached => break highest.max(found),
                        // The walk checks whether the `switch` is exhaustive.
                        Some(_) => break at.0,
                    }
                }
            };
            if at.is_none() {
                break 0;
            }
        };
        // A loop whose entry is unreachable has neverType, not `unreachableNeverType`.
        if found == NEVER_RETURNS
            && let Some(last_loop) = last_loop
        {
            for at in passed.drain(last_loop + 1..) {
                self.flow_memo.unsettled_call_before[at.idx()] = found;
            }
            found = passed[last_loop].0;
        }
        for at in passed {
            self.flow_memo.unsettled_call_before[at.idx()] = found;
        }
        found
    }

    /// True if a walk has already found every call statement that mentions `s`, numbered up to
    /// `highest`, to be idle. No call is resolved here, because that may re-enter the computation
    /// in progress, and tsgo resolves it when a walk reaches it.
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

    /// Not in tsgo. True if the walk for `reference` (the expression `e`), which passes no node
    /// above `highest`, may pass one of `computed_key_nodes` that resolves a key's name for it.
    #[inline(never)]
    fn may_resolve_key(&self, reference: &Reference, e: ExprId, highest: u32) -> bool {
        let (bound, memo) = (self.bound(reference.file), &self.flow_memo);
        let is_access = !reference.path.is_empty();
        let mut lowest = memo.min_antecedent[bound.flow_of_expr(e).idx()];
        // Only the walk for an access expression ends at the start of its function.
        if !is_access || bound.is_in_type_query(e) {
            while let Flow::Start { outer, .. } | Flow::StartInvoked { outer, .. } =
                bound.flow[lowest as usize]
                && outer.0 < lowest
            {
                lowest = memo.min_antecedent[outer.idx()];
            }
        }
        let keys = &memo.computed_key_nodes;
        keys[keys.partition_point(|node| node.0 < lowest)..]
            .iter()
            .take_while(|node| node.0 <= highest)
            .any(|node| is_access || node.1 == ResolvesKey::Always)
    }

    /// Not in tsgo. True if `getFlowTypeOfReference` can only return `declared` for `reference`
    /// (the expression `e`) and resolves nothing along the way. See `index_narrowing_subjects`,
    /// `may_resolve_key` and `highest_unsettled_call`.
    fn is_never_narrowed(
        &mut self,
        reference: &Reference,
        e: ExprId,
        declared: TypeId,
        start: Start,
    ) -> bool {
        let file = reference.file;
        if !matches!(reference.root, Root::Symbol(_) | Root::Other)
            || reference.unresolved.get() != 0
            || self.task.file != Some(file)
            || self.is_automatic_type(declared)
            // See `NarrowingSubjects::add_union`.
            || self.is_unresolved_name(declared)
        {
            return false;
        }
        if self.flow_memo.narrowing_index_file != Some(file) {
            cold_path();
            self.index_narrowing_subjects(file);
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        let memo = &self.flow_memo;
        let flow = bound.flow_of_expr(e);
        // Nothing matches `f()["a"]` or `a[i]`, and an assignment to `a` leaves `a[i]` as declared.
        let matches_nothing =
            |step: &Step| step.name.get() == AccessedName::None && step.variable == Root::Other;
        if reference.root == Root::Other || reference.path.last().is_some_and(matches_nothing) {
            return start == Start::Known
                && !memo.first_narrowing_node.is_empty()
                && !self.may_resolve_key(reference, e, memo.max_antecedent[flow.idx()])
                && matches!(self.first_unsettled_call(file, flow), 0 | NEVER_RETURNS);
        }
        let Root::Symbol(s) = reference.root else {
            return false;
        };
        let Some(&first_about) = memo.first_narrowing_node.get(s.idx()) else {
            return false;
        };
        let symbol = bound.symbol(s);
        // True for a `let`, `const` or `using` with an initializer, in a statement list, that `e`
        // comes after. Then every backward path from `e` reaches the declaration. (Not in a `case`,
        // nor `if (a) const b = 1`, which is an error but parses.)
        let is_dominated_by_declaration = match symbol.decls[..] {
            [Decl::Var(_)] => match self.root_declaration(file, s) {
                PatParent::Var(d) => {
                    let stmt = bound.var_stmt[d.idx()];
                    hir[d].kind != VarKind::Var
                        && hir[d].init.is_some()
                        && e.0 > hir[d].init.0
                        && stmt.is_some()
                        && match bound.parent_of_stmt(stmt) {
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
        let mut highest = memo.max_antecedent[flow.idx()];
        if is_dominated_by_declaration
            && let Some(&declaration_max) = memo
                .max_antecedent
                .get(memo.declaration_node[s.idx()] as usize)
            && highest <= declaration_max.max(flow.0)
        {
            highest = flow.0;
        }
        if first_about <= highest
            || !memo.computed_key_nodes.is_empty() && self.may_resolve_key(reference, e, highest)
        {
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
        if !is_plain
            || self.flow_memo.in_call_statements[s.idx() / 64] & 1 << (s.idx() % 64) != 0
                && !self.are_call_statements_idle(file, s, highest)
        {
            return false;
        }
        // `initialType` includes `undefined`. The walk ends at the declaration, so it passes no
        // call before that.
        if is_dominated_by_declaration
            && reference.path.is_empty()
            && self.p.files.options.strict_null_checks
        {
            let unsettled = self.highest_unsettled_call(file, flow);
            return matches!(unsettled, 0 | NEVER_RETURNS)
                || unsettled < self.flow_memo.declaration_node[s.idx()];
        }
        matches!(self.first_unsettled_call(file, flow), 0 | NEVER_RETURNS)
    }

    /// The `checkIdentifier` loop that moves `flowContainer` out of the functions that close over
    /// the variable `e` refers to.
    fn crossing_of_identifier(
        &mut self,
        file: FileId,
        e: ExprId,
        sym: Sym,
        declared: TypeId,
    ) -> Crossing {
        let bound = self.bound(file);
        let s = bound.symbol_of_expr(e);
        if s.is_none() {
            // `isConstantVariable(localOrExportSymbol)`: nothing in the file binds the name, so
            // `declarationContainer` is none of the containers of `e`.
            let flags = self.files().flags(sym);
            let is_constant_variable =
                flags.intersects(SymFlags::VARIABLE) && flags.contains(SymFlags::CONST);
            if is_constant_variable && declared != self.auto_array_type {
                return Crossing::Yes;
            }
            // `isParameterOrMutableLocalVariable(symbol) && isPastLastAssignment(symbol, e)`: the
            // assignments are those of the file that declares it, and their position is compared
            // with that of `e` in this file.
            if let Some((decl_file, Decl::Var(pat))) = self.files().value_declaration(sym) {
                let symbol = self.bound(decl_file).pat_symbol[pat.idx()];
                if symbol.is_some()
                    && self.is_parameter_or_mutable_local_variable(decl_file, symbol)
                {
                    let last = self.last_assignment_pos_of_global(decl_file, symbol, pat);
                    let pos = self.end_of_token_before(file, self.hir(file)[e].pos);
                    if last == 0 || last < pos {
                        return Crossing::Yes;
                    }
                }
            }
            return Crossing::No;
        }
        let flags = bound.symbol(s).flags;
        if flags.contains(SymFlags::CONST) && declared != self.auto_array_type {
            Crossing::UpToDeclaration(s, e)
        } else if !flags.intersects(SymFlags::VARIABLE) {
            Crossing::No
        } else {
            // FOR SPEED: evaluated when a walk reaches the start of a function.
            Crossing::PastLastAssignment(s, e)
        }
    }

    /// `lastAssignmentPos` of a `let` in a `declare global { }` in `declaring`.
    /// `markNodeAssignments` resolves each assigned name, so it also finds the file's assignments
    /// that the binder left without a symbol.
    fn last_assignment_pos_of_global(
        &self,
        declaring: FileId,
        symbol: SymbolId,
        pat: PatId,
    ) -> u32 {
        let (hir, bound) = (self.hir(declaring), self.bound(declaring));
        let name = bound.symbol(symbol).name;
        let declaring_function = function_or_source_file_of(hir, hir.node(pat));
        let mut last = self.last_assignment_pos(declaring, symbol);
        for &(target, _) in bound.free_idents.iter() {
            if matches!(hir[target].kind, ExprKind::Ident(it) if it == name)
                && bound.get_assignment_target_kind(hir, target) != AssignmentKind::None
            {
                let referencing_function = function_or_source_file_of(hir, hir.node(target));
                last = last.max(if referencing_function == declaring_function {
                    self.extend_assignment_position(declaring, target, hir[pat].pos)
                } else {
                    u32::MAX
                });
            }
        }
        last
    }

    /// `start` describes `initialType`, and `Known` means `declared`. `name_crossing` describes
    /// `flowContainer`, if `e` is a name.
    fn flow_type_of(
        &mut self,
        file: FileId,
        e: ExprId,
        declared: TypeId,
        start: Start,
        name_crossing: Crossing,
    ) -> TypeId {
        if self.flow_analysis_disabled.contains(&file) {
            cold_path();
            return TypeId::ERROR;
        }
        let bound = self.bound(file);
        let flow = bound.flow_of_expr(e);
        // `getTypeAtFlowNode`: an unreachable flow node has `convertAutoToAny(declaredType)`.
        if flow == UNREACHABLE {
            cold_path();
            return self.convert_auto_to_any(declared);
        }
        let mut reference = self.reference_of(file, e);
        if self.is_never_narrowed(&reference, e, declared, start) {
            return declared;
        }
        let is_automatic = self.is_automatic_type(declared);
        let crossing = if !reference.path.is_empty() {
            // `getTypeAtFlowNode` stops at the start of a function for a property or element access
            // expression. `a.b` in `typeof a.b` is a qualified name, and continues.
            if bound.is_in_type_query(e) {
                reference.accesses = 0;
                Crossing::Yes
            } else {
                Crossing::No
            }
        } else {
            name_crossing
        };
        let mut initial = declared;
        // `removeOptionalityFromDeclaredType`: `(x: T | undefined = d)` starts without `undefined`.
        if self.p.files.options.strict_null_checks
            && reference.path.is_empty()
            && let Root::Symbol(s) = reference.root
            && bound.symbol(s).flags.contains(SymFlags::PARAMETER)
            && let Some(pat) = self.name_of_value_declaration(file, s)
            && let PatParent::Param(p) = bound.pat_parent[pat.idx()]
            && self.hir(file)[p].default.is_some()
            && self.has_type_facts(declared, facts::IS_UNDEFINED)
            && !self.parameter_initializer_contains_undefined(file, p, pat)
        {
            initial = self.type_with_facts(declared, facts::NE_UNDEFINED);
        }
        let mut walk = Walk::new(reference, declared, initial, crossing);
        // `isAutomaticTypeInNonNull`
        if start == Start::Unassigned || is_automatic && self.is_operand_of_non_null(file, e) {
            self.start_unassigned(&mut walk);
        } else {
            walk.start = start;
        }
        let ty = self.get_flow_type_of_reference(&mut walk, flow);
        // `checkIdentifier`, `isAutomaticTypeInNonNull`
        if is_automatic && self.is_operand_of_non_null(file, e) {
            return self.non_nullable(ty);
        }
        ty
    }

    /// `c.flowAnalysisDisabled = true`, for the references in `file`.
    pub(crate) fn disable_flow_analysis(&mut self, file: FileId) {
        if !self.flow_analysis_disabled.contains(&file) {
            self.flow_analysis_disabled.push(file);
        }
    }

    /// `getFlowTypeOfReferenceEx`, once the `FlowState` is set up.
    fn get_flow_type_of_reference(&mut self, walk: &mut Walk, flow: FlowId) -> TypeId {
        let (file, e, declared) = (walk.reference.file, walk.reference.at, walk.declared);
        if self.flow_analysis_disabled.contains(&file) {
            cold_path();
            return TypeId::ERROR;
        }
        self.flow_invocation_count += 1;
        let outer = std::mem::replace(&mut self.walk_declared, declared);
        let evolved = self.flow_type(walk, flow);
        self.walk_declared = outer;
        // The walk that completes a loop continues with the entries its back edges left in
        // `sharedFlows`. The next walk finds the loop in `flowLoopCache` and may compute a
        // different type. Results derived from this walk's type stay in `flowTypeCache`.
        let depth = self.flow_type_cache_depth;
        if evolved.incomplete && depth != usize::MAX && self.is_flow_loop_visible(depth) {
            self.taint_from(depth);
        }
        let evolved = evolved.ty;
        // errorType, and `reportFlowControlError`
        if walk.too_deep {
            cold_path();
            self.disable_flow_analysis(file);
            self.report_flow_control_error(&walk.reference);
            return TypeId::ERROR;
        }
        if walk.steps >= MAX_STEPS {
            cold_path();
            return declared;
        }
        // An operation that adds elements to an evolving array sees `autoArrayType`, whatever its
        // element type is at that point.
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

    /// `getFlowTypeOfDestructuring` for a binding pattern element that isn't a rest element.
    /// `const { a } = o.p`: `a` has the narrowed type of `o.p.a` at that point. A rest element
    /// above it contributes its name or index like any other element
    /// (`getDestructuringPropertyName`).
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
                PatParent::Prop(parent, p) => {
                    at = parent;
                    self.literal_property_name_text(file, hir[p].key, hir[p].key_pos)
                }
                PatParent::Elem(parent, e) => {
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
        // `getParentElementAccess`. It uses a literal's direct syntactic parent, so a parenthesized
        // literal has no parent it recognizes.
        let init = loop {
            if !names.is_empty() && is_parenthesized(hir, at) {
                return declared;
            }
            let name = match bound.parent_of_expr(at) {
                Parent::Prop(p) if hir[p].kind != PropKind::Spread => {
                    at = bound.prop_owner[p.idx()];
                    self.literal_property_name_text(file, hir[p].key, hir[p].pos)
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

    /// `getSyntheticElementAccess`, then `getFlowTypeOfReference` of the result. Returns the
    /// narrowed type of `init.a.b`, declared as `declared`, at `init`'s position. `names` is `b`,
    /// `a`: innermost first.
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
        let flow = self.bound(file).flow_of_expr(init);
        if flow == UNREACHABLE {
            return declared;
        }
        let mut reference = self.reference_of(file, init);
        let steps = names.iter().rev().map(|&name| Step::from_name(name));
        reference.path.extend(steps);
        reference.accesses += names.len();
        // It doesn't occur in the source. Its parent is in the declaration or the assignment that
        // `init` is in.
        (reference.at, reference.node) = (ExprId::NONE, self.hir(file).node(init));
        let mut walk = Walk::new(reference, declared, declared, Crossing::No);
        self.get_flow_type_of_reference(&mut walk, flow)
    }

    /// True if `this.name` or `this[k]`, declared as `declared`, has been assigned by the end of
    /// the constructor `func`.
    pub(super) fn is_assigned_in_constructor(
        &mut self,
        file: FileId,
        func: FnId,
        key: AccessKey,
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
        let path = smallvec![match key {
            AccessKey::Name(name) => Step::from_name(name),
            AccessKey::Variable(variable) => Step {
                name: std::cell::Cell::new(AccessedName::None),
                variable,
            },
        }];
        let constructor = self.hir(file).node(func);
        let reference = Reference::synthetic(file, Root::This, path, constructor);
        let mut walk = Walk::new(reference, declared, initial, Crossing::No);
        let ty = self.get_flow_type_of_reference(&mut walk, exit);
        !self.contains_undefined(ty)
    }

    /// `getFlowTypeInConstructor`, and one iteration of `getFlowTypeInStaticBlocks`'s loop. Returns
    /// the type assigned to the untyped property `name` by the end of the constructor or static
    /// block `func`, or `None` if that isn't a usable type. `initial` is the type
    /// `getFlowTypeOfProperty` starts from: the property's type in the base class, else
    /// `undefined`. `value_declaration` is `symbol.ValueDeclaration`.
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
        let (path, parent) = (smallvec![Step::from_name(name)], self.hir(file).node(func));
        let reference = Reference::synthetic(file, Root::This, path, parent);
        let mut walk = Walk::new(reference, TypeId::AUTO, initial, Crossing::No);
        let ty = self.get_flow_type_of_reference(&mut walk, exit);
        if self.p.files.options.no_implicit_any && self.is_automatic_type(ty) {
            let at = self.span_of_untyped_property(file, value_declaration);
            // `symbolToString`
            let symbol_text = match value_declaration {
                UntypedProperty::Member(_) => self.source_text(file, at.1, at.2),
                UntypedProperty::Assignment(_) => self.atom_text(name),
            };
            self.error_at(at, 7008, &[Arg::Bytes(&symbol_text), Arg::Type(ty)]);
        }
        if self.is_every_type_nullable(ty) {
            return None;
        }
        Some(self.convert_auto_to_any(ty))
    }

    /// `getFlowTypeOfProperty`. Returns the flow type of `e`, an access to a property whose
    /// declared type is `autoType` in the constructor enclosing `e`. `initial` is the property's
    /// type in the base class, else `undefined`.
    pub(super) fn flow_type_of_property(
        &mut self,
        file: FileId,
        e: ExprId,
        initial: TypeId,
    ) -> TypeId {
        let flow = self.bound(file).flow_of_expr(e);
        // `getFlowNodeOfNode(reference) == nil`: `declaredType`. `expr_flow` has the unreachable
        // node for that too.
        if flow == UNREACHABLE
            && !self.flow_analysis_disabled.contains(&file)
            && !is_narrowable_reference(self.hir(file), e)
        {
            return TypeId::AUTO;
        }
        let reference = self.reference_of(file, e);
        let mut walk = Walk::new(reference, TypeId::AUTO, initial, Crossing::No);
        self.get_flow_type_of_reference(&mut walk, flow)
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
    fn is_marked_by_export_specifier(&self, file: FileId, symbol: SymbolId) -> bool {
        let (hir, bound, files) = (self.hir(file), self.bound(file), self.files());
        let name = bound.symbol(symbol).name;
        hir.exports.iter().enumerate().any(|(i, export)| {
            !export.has_module_specifier
                && !export.type_only
                && (export.items.iter()).any(|s| hir[s].local == name && !hir[s].type_only)
                && files.resolve_name(file, bound.export_scope[i], name, SymFlags::VALUE)
                    == Some(files.sym(file, symbol))
        })
    }

    /// `lastAssignmentPos` of a parameter or mutable local variable, as `markNodeAssignments` leaves
    /// it when it walks the function that declares the variable. 0 means the walk finds no
    /// assignment. `u32::MAX` is `math.MaxInt32`.
    ///
    /// tsc also walks a function below a node that no walk enters, such as the function in
    /// `class C extends mix(function () {})`, if it gets there before it has walked an enclosing
    /// function. That depends on the order of the checks, and isn't done here.
    fn last_assignment_pos(&self, file: FileId, symbol: SymbolId) -> u32 {
        let known = &self.flow_memo.last_assignment_positions;
        if let Some(&known) = known.borrow().get(&(file, symbol)) {
            return known;
        }
        let position = self.find_last_assignment_pos(file, symbol);
        known.borrow_mut().insert((file, symbol), position);
        position
    }

    /// Computes `last_assignment_pos`.
    fn find_last_assignment_pos(&self, file: FileId, symbol: SymbolId) -> u32 {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let Some(pat) = self.name_of_value_declaration(file, symbol) else {
            return 0;
        };
        if self.is_marked_by_export_specifier(file, symbol) {
            return u32::MAX;
        }
        let declaring_function = function_or_source_file_of(hir, hir.node(pat));
        let mut last = ExprId::NONE;
        for &(_, assignment) in bound.assignments_to(symbol) {
            let node = hir.node(assignment);
            match is_marked_in_nested_function(hir, declaring_function, node) {
                None => {}
                Some(true) => return u32::MAX,
                Some(false) => last = assignment,
            }
        }
        (last.some()).map_or(0, |last| {
            self.extend_assignment_position(file, last, hir[pat].pos)
        })
    }

    /// `isSymbolAssignedDefinitely`. `+=` and `++` modify a value. They don't initialize one.
    pub(super) fn is_symbol_assigned_definitely(&self, file: FileId, symbol: SymbolId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let Some(pat) = self.name_of_value_declaration(file, symbol) else {
            return false;
        };
        let declaring_function = function_or_source_file_of(hir, hir.node(pat));
        bound.assignments_to(symbol).iter().any(|&(_, assignment)| {
            let node = hir.node(assignment);
            bound.get_assignment_target_kind(hir, assignment) == AssignmentKind::Definite
                && is_marked_in_nested_function(hir, declaring_function, node).is_some()
        })
    }

    /// `isParameterOrMutableLocalVariable(symbol) && isPastLastAssignment(symbol, e)`
    pub(super) fn is_past_last_assignment(
        &mut self,
        file: FileId,
        symbol: SymbolId,
        e: ExprId,
    ) -> bool {
        if !self.is_parameter_or_mutable_local_variable(file, symbol) {
            return false;
        }
        let last = self.last_assignment_pos(file, symbol);
        last == 0 || last < self.end_of_token_before(file, self.hir(file)[e].pos)
    }

    /// `extendAssignmentPosition`. Only a statement moves the position, and the first statement
    /// around the function that declares the variable ends the climb.
    fn extend_assignment_position(&self, file: FileId, node: ExprId, declaration: u32) -> u32 {
        let hir = self.hir(file);
        // `node.Pos()`: 0 for the first token of the file.
        let mut pos = self.end_of_token_before(file, hir[node].pos);
        let mut at = hir.parent(hir.node(node));
        while at.is_some() {
            if let NodeData::Stmt(stmt) = hir.data(at) {
                if hir[stmt].start <= declaration {
                    return pos;
                }
                if matches!(
                    hir.kind(at),
                    Kind::VariableStatement
                        | Kind::ExpressionStatement
                        | Kind::IfStatement
                        | Kind::DoStatement
                        | Kind::WhileStatement
                        | Kind::ForStatement
                        | Kind::ForInStatement
                        | Kind::ForOfStatement
                        | Kind::WithStatement
                        | Kind::SwitchStatement
                        | Kind::TryStatement
                        | Kind::ClassDeclaration
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
    #[inline(always)]
    fn finalize_evolving_array(&mut self, ty: TypeId) -> TypeId {
        match *self.data(ty) {
            TypeData::EvolvingArray(element) => self.final_array_type(ty, element),
            _ => ty,
        }
    }

    /// `createFinalArrayType` for the evolving array type `ty`, whose element type is `element`.
    #[inline(never)]
    fn final_array_type(&mut self, ty: TypeId, element: TypeId) -> TypeId {
        if element.is_never() {
            return self.auto_array_type;
        }
        if !self.is_union(element) {
            return self.array_of(element);
        }
        if let Some(&known) = self.flow_memo.final_array_types.get(&ty) {
            return known;
        }
        let scope = self.begin_scope();
        let parts = self.parts(element);
        let element = self.union_reduced(parts);
        let result = self.array_of(element);
        if self.end_scope_by_counters(scope).is_ok() {
            self.flow_memo.final_array_types.insert(ty, result);
        }
        result
    }

    /// Returns the type at a join of control flow paths. Evolving arrays stay evolving if all the
    /// types are evolving arrays. A type that isn't part of the reference's initial type was
    /// introduced by `instanceof`, `in` or a type guard, and is removed again where it joins a type
    /// it's a subtype of.
    fn union_or_evolving(&mut self, types: &[TypeId], walk: &mut Walk) -> TypeId {
        if types.len() < 2 {
            return self.union_or_evolving_with(types, Join::Literal);
        }
        let initial = self.initial_of(walk);
        let is_subset = |t: TypeId| {
            t == initial
                || t.is_never()
                || self.is_union(initial) && self.is_type_subset_of_union(t, initial)
        };
        match types.iter().all(|&t| is_subset(t)) {
            true => self.union_or_evolving_with(types, Join::Literal),
            false => self.union_or_evolving_with(types, Join::Subtype),
        }
    }

    /// `getUnionOrEvolvingArrayType`
    fn union_or_evolving_with(&mut self, types: &[TypeId], join: Join) -> TypeId {
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
            let union = match join {
                Join::Literal => self.union(types),
                Join::Subtype => self.union_reduced(types),
            };
            let union = self.recombine_unknown_type(union);
            // The union of all the members of the declared type is the declared type. A fresh
            // `true` or `false` that an assignment left isn't a member of it.
            if union != self.walk_declared
                && let (TypeData::Union(parts), TypeData::Union(declared)) =
                    (self.data(union), self.data(self.walk_declared))
                && parts == declared
            {
                return self.walk_declared;
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
                    return self.union_or_evolving_with(&types, join);
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
            let Parent::Expr(parent) = bound.parent_of_expr(root) else {
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
        // Only the direct syntactic parent of `x.push` and `x[n]` counts. `(x.push)(v)` and
        // `(x[n]) = v` don't qualify.
        match hir[parent].kind {
            ExprKind::Dot { obj, name, .. } if obj == root => {
                name == known::length
                    || (name == known::push || name == known::unshift)
                        && !is_parenthesized(hir, parent)
                        // A call that contains it, even as an argument.
                        && matches!(bound.parent_of_expr(parent), Parent::Expr(call) if matches!(hir[call].kind, ExprKind::Call(_)))
            }
            ExprKind::Index { obj, index, .. } if obj == root => {
                let Parent::Expr(assign) = bound.parent_of_expr(parent) else {
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

    /// Returns what `getContextFreeTypeOfExpression` returns for the call `e` if nothing has
    /// resolved the call, or the calls inside it, before. (`e`'s contextual type also applies to a
    /// call in its arguments if a type parameter carries it there.) A tool that asks before it
    /// checks the file gets that answer. Here the file is checked first, so the stored signatures
    /// were inferred with the call's contextual type. None of this computation is cached.
    pub(super) fn context_free_type_of_freshly_resolved_call(
        &mut self,
        file: FileId,
        e: ExprId,
    ) -> TypeId {
        let reported = self.reported.len();
        let level = self.inference_contexts.len() + 1;
        let outer = std::mem::replace(&mut self.context_free_level, level);
        let range = (file, self.hir(file)[e].pos, self.end_of_expr(file, e));
        let outer_range = self.calls_to_resolve_afresh.replace(range);
        let outer_resolved = std::mem::take(&mut self.calls_resolved_afresh);
        let (ty, _) = self.run_memoizable(|c| {
            let mode = CheckMode::SKIP_CONTEXT_SENSITIVE;
            c.check_expression_with_contextual_type(file, e, TypeId::ANY, None, mode)
        });
        self.calls_to_resolve_afresh = outer_range;
        self.calls_resolved_afresh = outer_resolved;
        self.context_free_level = outer;
        self.reported.truncate(reported);
        ty
    }

    /// `getContextFreeTypeOfExpression`. tsgo caches the first result, even one that depends on a
    /// loop's incomplete type (`FlowMemo::context_free_types_in_loops`).
    pub(super) fn context_free_type_of_expression(&mut self, file: FileId, e: ExprId) -> TypeId {
        if let Some(cached_type) = self.p.context_free_expr_types.get(&self.task, &(file, e)) {
            return cached_type;
        }
        let in_loops = &self.flow_memo.context_free_types_in_loops;
        if !in_loops.is_empty()
            && let Some(&cached_type) = in_loops.get(&(file, e))
        {
            return cached_type;
        }
        let depth = self.flow_type_cache_depth;
        let is_in_back_edge = depth != usize::MAX && self.is_flow_loop_visible(depth);
        let level = self.inference_contexts.len() + 1;
        let outer = std::mem::replace(&mut self.context_free_level, level);
        let (ty, stored) = self.run_memoizable(|c| {
            let mode = CheckMode::SKIP_CONTEXT_SENSITIVE;
            c.check_expression_with_contextual_type(file, e, TypeId::ANY, None, mode)
        });
        self.check_expression_in_flow_loop(file, e);
        self.context_free_level = outer;
        if let Some(stored) = stored
            && !self.is_stack_low()
        {
            (self.p.context_free_expr_types).rewrite(&self.task, (file, e), ty, stored);
        } else if is_in_back_edge && ty != TypeId::UNRESOLVED {
            let in_loops = &mut self.flow_memo.context_free_types_in_loops;
            in_loops.insert((file, e), ty);
        }
        ty
    }

    /// `addEvolvingArrayElementType`. Returns the evolving array `ty` after `value` is added to it.
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
            cold_path();
            return FlowType::new(TypeId::ERROR, false);
        }
        let file = walk.reference.file;
        let bound = self.bound(file);
        // The invocations waiting for the type at their antecedent, outermost first, each with its
        // `sharedFlow`. They resume afterwards, innermost first.
        let mut pending: SmallVec<[(Pending, FlowId); 8]> = SmallVec::new();
        // Number of invocations for a condition that doesn't apply to the reference and that have
        // no `sharedFlow`. They return their input unchanged.
        let mut passed = 0;
        let mut flow = start;
        // `sharedFlow` of the innermost invocation.
        let mut shared_flow = FlowId::NONE;
        let (depth, crossed) = (walk.depth, walk.crossed);
        let mut incomplete = false;
        let mut ty = loop {
            walk.steps += 1;
            if walk.steps >= MAX_STEPS {
                cold_path();
                break walk.declared;
            }
            walk.depth = depth + 1 + pending.len() as u32 + passed;
            if walk.depth > MAX_FLOW_DEPTH {
                cold_path();
                walk.too_deep = true;
                break TypeId::ERROR;
            }
            if bound.is_shared(flow) {
                if let Some(known) = walk.shared_flows.get(flow) {
                    incomplete = known.incomplete;
                    shared_flow = FlowId::NONE;
                    break known.ty;
                }
                shared_flow = flow;
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
                            // Never walked without a path, or walked with `Crossing::Yes`.
                            Root::Super
                            | Root::ImportMeta
                            | Root::NewTarget(_)
                            | Root::Pattern(_)
                            | Root::Params(_)
                            | Root::Other => false,
                        };
                    if continues || self.settle_crossing(walk) {
                        flow = outer;
                        continue;
                    }
                    break self.initial_of(walk);
                }
                Flow::Assign { before, target } => {
                    match self.type_at_assignment(walk, flow, target) {
                        AtAssignment::Type(t) => break t,
                        AtAssignment::Antecedent(then) => {
                            pending.push((then, std::mem::take(&mut shared_flow)));
                        }
                        AtAssignment::Unaffected => {}
                    }
                    flow = before;
                }
                Flow::ArrayMutation { before, expr } => {
                    // `getTypeAtFlowArrayMutation`: a mutation of a different reference is skipped.
                    if self.is_automatic_type(walk.declared)
                        && self.is_mutation_of(&walk.reference, expr)
                    {
                        pending.push((Pending::Mutation(expr), std::mem::take(&mut shared_flow)));
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
                        let then = Pending::Cond(expr, sense);
                        pending.push((then, std::mem::take(&mut shared_flow)));
                    } else if shared_flow.is_some() {
                        pending.push((Pending::Nothing, std::mem::take(&mut shared_flow)));
                    } else {
                        passed += 1;
                    }
                    flow = before;
                }
                Flow::Switch { before, stmt, from } => {
                    let then = Pending::Switch(stmt, from);
                    pending.push((then, std::mem::take(&mut shared_flow)));
                    flow = before;
                }
                Flow::Call { before, call } => {
                    if self.flow_memo.is_idle_call(file, flow) {
                        let (arrived_at, passed) = self.before_idle_calls(file, flow, before);
                        walk.steps = walk.steps.saturating_add(passed);
                        flow = arrived_at;
                        continue;
                    }
                    // `getTypeAtFlowCall`
                    let (sig, is_cached) = self.effects_signature_and_is_cached(file, call);
                    if is_cached {
                        self.note_settled_call(file, flow, sig.is_none());
                    }
                    if let Some(sig) = sig {
                        match self.sig_predicate(sig) {
                            Some(predicate) if predicate.asserts => {
                                let then = Pending::Assert(call);
                                pending.push((then, std::mem::take(&mut shared_flow)));
                            }
                            _ if self.sig_return(sig).is_never() => {
                                break TypeId::UNREACHABLE_NEVER;
                            }
                            _ => {}
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
                Flow::Label { .. } => {
                    let antecedents = branch_label_antecedents(bound, flow, &walk.reduced);
                    if let [only] = *antecedents {
                        flow = only;
                        continue;
                    }
                    // `getTypeAtFlowBranchLabel`
                    let mut types: SmallVec<[TypeId; 4]> = SmallVec::new();
                    // The path that bypasses a `switch` when no case matched. It doesn't exist if
                    // the `switch` is exhaustive. That's only computed when it would change the
                    // result, because the computation can re-enter here.
                    let mut bypass = None;
                    let mut settled = false;
                    for &edge in antecedents {
                        if bypass.is_none()
                            && let Flow::Switch {
                                stmt,
                                from: Flow::NO_CLAUSE,
                                ..
                            } = bound.flow[edge.idx()]
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
                    break FlowType::new(self.union_or_evolving(&types, walk), incomplete).ty;
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
                    let has_key = match walk.has_reference_key {
                        Some(has_key) => has_key,
                        None => {
                            let has_key = self.has_flow_reference_key(&walk.reference);

                            walk.has_reference_key = Some(has_key);
                            has_key
                        }
                    };
                    if !has_key {
                        break walk.declared;
                    }
                    let initial = self.initial_of(walk);
                    let key = (file, flow, walk.declared, initial);
                    if let Some(cached) =
                        self.flow_memo.cached_flow_loop_type(&key, &walk.reference)
                    {
                        break cached;
                    }
                    // `flowLoopStack` belongs to the checker. A walk with the same key, started
                    // while another walk follows a back edge of this loop, gets the union of the
                    // antecedent types found so far, marked incomplete.
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
                    let entry = self.flow_type(walk, edges[0]);
                    // The result is incomplete only if the first antecedent is.
                    incomplete = entry.incomplete;
                    let entry = entry.ty;
                    let mut types: SmallVec<[TypeId; 4]> = smallvec![entry];
                    // tsgo never makes a walk in which a cycle is left unmarked because of `eager`,
                    // or in which a query is rejected because of its depth or at a limit tsgo
                    // doesn't have. In such a walk the value assigned on a back edge is missing, so
                    // none of its results go in `flowLoopCache`, which outlives the enclosing
                    // frames.
                    let interruptions_before = self.interruptions();
                    // Once the type is the declared type, only subtypes could be added. Unlike at a
                    // branch label, the initial type isn't considered.
                    if entry != walk.declared {
                        // One pass: each back edge sees the types of the antecedents before it.
                        walk.back_edges += 1;
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
                            restarted = (self.flow_memo)
                                .cached_flow_loop_type(&key, &walk.reference)
                                .filter(|_| interruptions_before == self.interruptions());
                            if restarted.is_some() {
                                break;
                            }
                            if t == walk.declared {
                                types.push(t);
                                break;
                            }
                            if !types.contains(&t) {
                                types.push(t);
                                let so_far = self.union_or_evolving_with(&types, Join::Literal);
                                if let Some(shared) = self.flow_loops.last_mut() {
                                    shared.4 = so_far;
                                }
                            }
                        }
                        self.flow_loops.pop();
                        walk.back_edges -= 1;
                        if let Some(cached) = restarted {
                            incomplete = false;
                            break cached;
                        }
                    }
                    let result = FlowType::new(self.union_or_evolving(&types, walk), incomplete);
                    // A result that depends on a speculative evaluation, a provisional type or a
                    // walk that bailed out isn't cached.
                    if !incomplete
                        && !walk.too_deep
                        && walk.steps < MAX_STEPS
                        && interruptions_before == self.interruptions()
                    {
                        self.flow_memo
                            .flow_loop_cache
                            .entry(key)
                            .or_default()
                            .push((walk.reference.clone(), result.ty));
                        self.flow_memo.flow_loop_cached_at = self.work;
                    }
                    break result.ty;
                }
            }
        };
        (walk.depth, walk.crossed) = (depth, crossed);
        if walk.too_deep {
            cold_path();
            return FlowType::new(TypeId::ERROR, false);
        }
        if shared_flow.is_some() {
            walk.shared_flows
                .push(shared_flow, FlowType { ty, incomplete });
        }
        let reference = &walk.reference;
        while let Some((then, shared_flow)) = pending.pop() {
            // A condition is applied to the finalized array type. If it narrows nothing, the array
            // stays evolving. `getTypeAtFlowArrayMutation` doesn't finalize it.
            let seen = match then {
                Pending::Mutation(_) | Pending::Nothing => ty,
                _ => self.finalize_evolving_array(ty),
            };
            let narrowed = match then {
                // Applied to the finalized array type, so the array stops evolving.
                Pending::NonNull => {
                    incomplete = false;
                    ty = seen;
                    self.non_nullable_type_if_needed(seen)
                }
                Pending::Nothing => seen,
                // Only `getTypeAtFlowCondition` returns `never` as is.
                Pending::Cond(..) if ty.is_never() => seen,
                Pending::Cond(expr, sense) => self.narrow(reference, seen, expr, sense),
                Pending::Switch(stmt, from) => self.narrow_by_switch(reference, seen, stmt, from),
                Pending::Assert(call) => self.narrow_by_assertion(reference, seen, call),
                Pending::Compound => self.base_of_literal(seen),
                Pending::Mutation(expr) => {
                    ty = self.after_array_mutation(file, ty, expr);
                    seen
                }
            };
            if narrowed != seen {
                ty = FlowType::new(narrowed, incomplete).ty;
            }
            if shared_flow.is_some() {
                walk.shared_flows
                    .push(shared_flow, FlowType { ty, incomplete });
            }
        }
        FlowType { ty, incomplete }
    }

    /// `checkNonNullTypeWithReporter`. Returns `ty` without `null` and `undefined`, for a position
    /// where neither is allowed. Calls `report` with `ty`'s problem, if it has one.
    pub(super) fn check_non_null_type_with_reporter(
        &mut self,
        ty: TypeId,
        report: impl FnOnce(&mut Self, NonNullError),
    ) -> TypeId {
        // Most types have neither fact, and their kind is enough to tell.
        let kinds = tf::UNKNOWN | tf::NULLABLE | tf::INSTANTIABLE_NON_PRIMITIVE | tf::INDEX;
        // `may_be_reduced` is true if `ty` is an intersection or has one as a member.
        if !self.may_be_reduced(ty) && !self.is_some_type_of_kind(ty, kinds) {
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
        let non_nullable = self.non_nullable(ty);
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
    pub(super) fn assignment_reduced_type(&mut self, declared: TypeId, assigned: TypeId) -> TypeId {
        if declared == assigned {
            return declared;
        }
        if self.is_any(assigned) {
            return declared;
        }
        if assigned.is_never() {
            return assigned;
        }
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

    /// `getTypeAtFlowAssignment`
    fn type_at_assignment(
        &mut self,
        walk: &Walk,
        flow: FlowId,
        target: FlowTarget,
    ) -> AtAssignment {
        let (reference, declared) = (&walk.reference, walk.declared);
        let file = reference.file;
        let (hir, bound) = (self.hir(file), self.bound(file));
        // The name is compared with a declaration if `containsMatchingReference` gets that far.
        let declares = |pat: PatId| {
            reference.root == Root::Symbol(bound.pat_symbol[pat.idx()])
                && reference.accesses == reference.path.len()
                && reference.assigned == usize::MAX
        };
        // Both resolve each access's name before they look at a declaration.
        if reference.unresolved.get() != 0 && !matches!(target, FlowTarget::Expr(_)) {
            cold_path();
            let len = reference.path.len();
            for step in (len - reference.accesses..len).rev() {
                self.name_of_step(reference, step);
            }
        }
        // `isMatchingReference(f.reference, node)`, or else `containsMatchingReference(f.reference, node)`
        let is_matching = match target {
            FlowTarget::Var(d) if declares(hir[d].pat) => reference.path.is_empty(),
            FlowTarget::Pat(p) if declares(p) => reference.path.is_empty(),
            FlowTarget::Expr(e) if self.matches(reference, e) => true,
            FlowTarget::Expr(e) if self.contains_matching_reference(reference, e) => false,
            _ if self.is_for_in_over(reference, target) => {
                return AtAssignment::Antecedent(Pending::NonNull);
            }
            _ => return AtAssignment::Unaffected,
        };
        if !self.is_reachable(file, flow) {
            return AtAssignment::Type(TypeId::UNREACHABLE_NEVER);
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
                return AtAssignment::Antecedent(Pending::Nothing);
            }
            return AtAssignment::Type(declared);
        }
        if let FlowTarget::Expr(e) = target
            && bound.get_assignment_target_kind(hir, e) == AssignmentKind::Compound
        {
            return AtAssignment::Antecedent(Pending::Compound);
        }
        if self.is_automatic_type(declared) {
            // `isEmptyArrayAssignment`
            let value = match target {
                FlowTarget::Var(d) => hir[d].init,
                FlowTarget::Expr(e) => match bound.parent_of_expr(e) {
                    Parent::Expr(parent) => match hir[parent].kind {
                        // `{ x = [] }` is a `ShorthandPropertyAssignment`, not a `BinaryExpression`.
                        ExprKind::Assign { value, .. }
                            if !bound.is_shorthand_property_assignment(hir, parent) =>
                        {
                            value
                        }
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
                return AtAssignment::Type(self.evolving_array(TypeId::NEVER));
            }
            let assigned = self.initial_or_assigned_type(walk, target);
            let assigned = self.widen_literal(assigned);
            return AtAssignment::Type(if self.is_assignable(assigned, declared) {
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
            return AtAssignment::Type(declared);
        }
        let assigned = self.initial_or_assigned_type(walk, target);
        AtAssignment::Type(self.assignment_reduced_type(declared, assigned))
    }

    /// `getTypeOfExpression`. `flowTypeCache` is only ported for the traversal of a loop back edge
    /// and for `type_of_expr_outside_loops`, where it holds what the shared expression cache
    /// doesn't store (`taint_from`). Everywhere else the shared cache stores every cacheable
    /// result.
    pub(super) fn get_type_of_expression(&mut self, file: FileId, e: ExprId) -> TypeId {
        let depth = self.flow_type_cache_depth;
        // `checkExpressionCached` computes with an empty cache, so a type resolution entered since
        // the traversal began hides this one.
        if depth == usize::MAX || !self.is_flow_loop_visible(depth) {
            return self.type_of_declaration_initializer_ex(file, e, Some(CheckMode::TYPE_ONLY));
        }
        if let Some(&cached) = self.flow_type_cache.get(&(file, e)) {
            // The entry was computed from an incomplete loop type.
            self.taint_from(depth);
            return cached;
        }
        let start = self.flow_invocation_count;
        let ty = self.type_of_declaration_initializer_ex(file, e, Some(CheckMode::TYPE_ONLY));
        if self.flow_invocation_count != start && self.cached_type_of_expr(file, e).is_none() {
            self.flow_type_cache.insert((file, e), ty);
        }
        ty
    }

    /// `getInitialOrAssignedType`
    fn initial_or_assigned_type(&mut self, walk: &Walk, target: FlowTarget) -> TypeId {
        let file = walk.reference.file;
        let ty = match target {
            FlowTarget::Var(d) => self.get_initial_type_of_variable_declaration(file, d),
            FlowTarget::Pat(p) => self.get_initial_type(file, p),
            FlowTarget::Expr(e) => self.get_assigned_type(file, e, walk.back_edges != 0),
        };
        match walk.reference.at.some() {
            Some(at) => self.get_narrowable_type_for_reference(file, at, ty, CheckMode::empty()),
            None => ty,
        }
    }

    /// `getTypeOfExpression(node.Right)`. `getTypeOfExpression` rechecks an expression that's
    /// already being checked, and terminates at the loop (`recheck_in_flow_loop`). Past a type
    /// resolution, which hides the loop, `enter` fails, so a cycle through a value assigned on a
    /// back edge may not be a cycle in TypeScript. `mark_cycle_from` identifies those.
    fn type_of_assigned_value(&mut self, file: FileId, value: ExprId, in_loop: bool) -> TypeId {
        if in_loop {
            self.eager.push(self.stack.len());
            self.loop_values.push(self.stack.len());
        }
        let ty = self.get_type_of_expression(file, value);
        if in_loop {
            self.loop_values.pop();
            self.eager.pop();
        }
        ty
    }

    /// `getInitialType` of the variable declaration or the binding element whose name is `pat`.
    fn get_initial_type(&mut self, file: FileId, pat: PatId) -> TypeId {
        match self.bound(file).pat_parent[pat.idx()] {
            PatParent::Var(d) => self.get_initial_type_of_variable_declaration(file, d),
            PatParent::Prop(..) | PatParent::Elem(..) => {
                self.get_initial_type_of_binding_element(file, pat)
            }
            PatParent::Param(_) | PatParent::None => TypeId::ERROR,
        }
    }

    /// `getTypeOfInitializer`, which is `getTypeOfExpression` if `checkExpressionCached` hasn't
    /// assigned `links.resolvedType`. It doesn't touch `flowLoopStack`, so the requesting
    /// resolutions don't hide any loop from the initializer.
    pub(super) fn get_type_of_initializer(&mut self, file: FileId, init: ExprId) -> TypeId {
        // A recheck doesn't look at `links.resolvedType` by itself.
        if self.is_rechecking()
            && let Some(known) = self.cached_type_of_expr(file, init)
        {
            return known;
        }
        self.with_flow_loops_visible(|c| c.get_type_of_expression(file, init))
    }

    /// `getInitialTypeOfVariableDeclaration`
    fn get_initial_type_of_variable_declaration(&mut self, file: FileId, d: VarDeclId) -> TypeId {
        let init = self.hir(file)[d].init;
        if init.is_some() {
            return self.get_type_of_initializer(file, init);
        }
        let head = self.bound(file).var_stmt[d.idx()];
        self.initial_type_of_for_head(file, head)
            .unwrap_or(TypeId::ERROR)
    }

    /// `getInitialTypeOfBindingElement`
    fn get_initial_type_of_binding_element(&mut self, file: FileId, pat: PatId) -> TypeId {
        let hir = self.hir(file);
        let (ty, default) = match self.bound(file).pat_parent[pat.idx()] {
            PatParent::Prop(pattern, prop) => {
                let parent_type = self.get_initial_type(file, pattern);
                let name = binding_element_property_name(hir, prop);
                let pos = hir[prop].key_pos;
                (
                    self.get_type_of_destructured_property(file, parent_type, name, pos),
                    hir[prop].default,
                )
            }
            PatParent::Elem(pattern, elem) => {
                let parent_type = self.get_initial_type(file, pattern);
                let PatKind::Array(elems) = hir[pattern].kind else {
                    return TypeId::ERROR;
                };
                let ty = if hir[elem].is_rest {
                    self.get_type_of_destructured_spread_expression(parent_type)
                } else {
                    let index = (elem.0 - elems.start) as usize;
                    self.get_type_of_destructured_array_element(parent_type, index)
                };
                (ty, hir[elem].default)
            }
            _ => return TypeId::ERROR,
        };
        self.get_type_with_default(file, ty, default, false)
    }

    /// `getAssignedType`. `in_loop` means `node` belongs to an assignment on the back edge of a
    /// loop in progress.
    fn get_assigned_type(&mut self, file: FileId, node: ExprId, in_loop: bool) -> TypeId {
        let (hir, bound) = (self.hir(file), self.bound(file));
        match bound.parent_of_expr(node) {
            Parent::Stmt(head) => {
                // `checkRightHandSideOfForOf`, behind the barrier of `type_of_assigned_value`.
                if in_loop {
                    self.eager.push(self.stack.len());
                    self.loop_values.push(self.stack.len());
                }
                let ty = self.initial_type_of_for_head(file, head);
                if in_loop {
                    self.loop_values.pop();
                    self.eager.pop();
                }
                ty.unwrap_or(TypeId::ERROR)
            }
            Parent::Expr(parent) => match hir[parent].kind {
                // `{ x = d }` is a `ShorthandPropertyAssignment` with an
                // `ObjectAssignmentInitializer`.
                ExprKind::Assign { value, .. } => match bound.parent_of_expr(parent) {
                    Parent::Prop(prop) if hir[prop].kind == PropKind::Shorthand => {
                        let ty = self.get_assigned_type_of_property_assignment(file, prop, in_loop);
                        self.get_type_with_default(file, ty, value, in_loop)
                    }
                    _ => self.get_assigned_type_of_binary_expression(file, parent, in_loop),
                },
                ExprKind::Binary { .. } => {
                    self.get_assigned_type_of_binary_expression(file, parent, in_loop)
                }
                ExprKind::Unary {
                    op: UnOp::Delete, ..
                } => TypeId::UNDEFINED,
                // `getAssignedTypeOfArrayLiteralElement`
                ExprKind::Array(elements) => {
                    let ty = self.get_assigned_type(file, parent, in_loop);
                    match hir.ids(elements).position(|element| element == node) {
                        Some(index) => self.get_type_of_destructured_array_element(ty, index),
                        None => TypeId::ERROR,
                    }
                }
                // `getAssignedTypeOfSpreadExpression`
                ExprKind::Spread(_) => match bound.parent_of_expr(parent) {
                    Parent::Expr(list) => {
                        let ty = self.get_assigned_type(file, list, in_loop);
                        self.get_type_of_destructured_spread_expression(ty)
                    }
                    _ => TypeId::ERROR,
                },
                _ => TypeId::ERROR,
            },
            Parent::Prop(prop)
                if matches!(hir[prop].kind, PropKind::Init | PropKind::Shorthand) =>
            {
                self.get_assigned_type_of_property_assignment(file, prop, in_loop)
            }
            _ => TypeId::ERROR,
        }
    }

    /// `getAssignedTypeOfBinaryExpression`
    fn get_assigned_type_of_binary_expression(
        &mut self,
        file: FileId,
        node: ExprId,
        in_loop: bool,
    ) -> TypeId {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let (ExprKind::Assign { value: right, .. } | ExprKind::Binary { right, .. }) =
            hir[node].kind
        else {
            return TypeId::ERROR;
        };
        let is_destructuring_default_assignment = !is_parenthesized(hir, node)
            && match bound.parent_of_expr(node) {
                Parent::Expr(parent) => {
                    matches!(hir[parent].kind, ExprKind::Array(_))
                        && self.is_destructuring_assignment_target(file, parent)
                }
                Parent::Prop(prop) => {
                    hir[prop].kind == PropKind::Init
                        && self
                            .is_destructuring_assignment_target(file, bound.prop_owner[prop.idx()])
                }
                _ => false,
            };
        if is_destructuring_default_assignment {
            let ty = self.get_assigned_type(file, node, in_loop);
            return self.get_type_with_default(file, ty, right, in_loop);
        }
        self.type_of_assigned_value(file, right, in_loop)
    }

    /// `getTypeOfDestructuredArrayElement`
    fn get_type_of_destructured_array_element(&mut self, ty: TypeId, index: usize) -> TypeId {
        if self.parts(ty).iter().all(|&t| self.is_tuple_like(t))
            && let Some(element_type) = self.get_tuple_element_type(ty, index)
        {
            return element_type;
        }
        let element_type = self.iterated_type_of_destructuring_in_flow(ty);
        self.include_undefined_in_index_signature(element_type)
    }

    /// `getTupleElementType`
    fn get_tuple_element_type(&mut self, ty: TypeId, index: usize) -> Option<TypeId> {
        let name = self.number_name(index as f64);
        if let Some(prop_type) = self.type_of_property_of_type(ty, name) {
            return Some(prop_type);
        }
        if !self.every_type(ty, |c, t| c.is_tuple(t)) {
            return None;
        }
        let undefined_like_type =
            (self.p.files.options.no_unchecked_indexed_access).then_some(TypeId::UNDEFINED);
        Some(self.get_tuple_element_type_out_of_start_count(ty, index, undefined_like_type))
    }

    /// `getTupleElementTypeOutOfStartCount`
    fn get_tuple_element_type_out_of_start_count(
        &mut self,
        ty: TypeId,
        index: usize,
        undefined_like_type: Option<TypeId>,
    ) -> TypeId {
        self.map_type(ty, |c, t| {
            let TypeData::Tuple { flags, .. } = c.data(t) else {
                return t;
            };
            // `getRestTypeOfTupleType`
            let (elems, fixed) = (c.type_arguments(t), Self::fixed_length(flags));
            if fixed == flags.len() {
                return TypeId::UNDEFINED;
            }
            let rest_type = c.tuple_element_union(&elems[fixed..], &flags[fixed..]);
            match undefined_like_type {
                Some(undefined_like_type) if index >= Self::total_fixed_element_count(flags) => {
                    c.union(&[rest_type, undefined_like_type])
                }
                _ => rest_type,
            }
        })
    }

    /// `includeUndefinedInIndexSignature`
    fn include_undefined_in_index_signature(&mut self, ty: TypeId) -> TypeId {
        if self.p.files.options.no_unchecked_indexed_access {
            self.with_missing(ty)
        } else {
            ty
        }
    }

    /// `getTypeOfDestructuredSpreadExpression`
    fn get_type_of_destructured_spread_expression(&mut self, ty: TypeId) -> TypeId {
        let element_type = self.iterated_type_of_destructuring_in_flow(ty);
        self.array_of(element_type)
    }

    /// `getAssignedTypeOfPropertyAssignment`
    fn get_assigned_type_of_property_assignment(
        &mut self,
        file: FileId,
        prop: PropId,
        in_loop: bool,
    ) -> TypeId {
        let owner = self.bound(file).prop_owner[prop.idx()];
        let ty = self.get_assigned_type(file, owner, in_loop);
        let prop_node = &self.hir(file)[prop];
        self.get_type_of_destructured_property(file, ty, prop_node.key, prop_node.pos)
    }

    /// `getTypeOfDestructuredProperty`, for the name `name` at `pos`.
    fn get_type_of_destructured_property(
        &mut self,
        file: FileId,
        ty: TypeId,
        name: PropKey,
        pos: u32,
    ) -> TypeId {
        let Some(text) = self.try_get_name_from_property_name(file, name, pos) else {
            return TypeId::ERROR;
        };
        if let Some(prop_type) = self.type_of_property_of_type(ty, text) {
            return prop_type;
        }
        let index_info = self
            .members_for_index_infos(ty)
            .and_then(|members| self.applicable_index_info_for_name(&members, text));
        match index_info {
            Some(info) => self.include_undefined_in_index_signature(info.value),
            None => TypeId::ERROR,
        }
    }

    /// `isDestructuringAssignmentTarget`
    fn is_destructuring_assignment_target(&self, file: FileId, parent: ExprId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        !is_parenthesized(hir, parent)
            && match bound.parent_of_expr(parent) {
                Parent::Expr(above) => matches!(
                    hir[above].kind,
                    ExprKind::Assign { target: left, .. } | ExprKind::Binary { left, .. }
                        if left == parent
                ),
                Parent::Stmt(head) => matches!(bound.parent_of_stmt(head), Parent::Stmt(owner)
                    if matches!(hir[owner].kind, StmtKind::ForOf { left, .. } if left == head)),
                _ => false,
            }
    }

    /// `getTypeWithDefault`
    pub(super) fn get_type_with_default(
        &mut self,
        file: FileId,
        ty: TypeId,
        default: ExprId,
        in_loop: bool,
    ) -> TypeId {
        if default.is_none() {
            return ty;
        }
        let (ty, default) = (
            self.non_undefined_type(ty),
            self.type_of_assigned_value(file, default, in_loop),
        );
        self.union(&[ty, default])
    }

    /// From `getInitialTypeOfVariableDeclaration` and `getAssignedType`. Returns the type assigned
    /// to `left`, the head of `for (x in o)` or `for (x of xs)`.
    fn initial_type_of_for_head(&mut self, file: FileId, left: StmtId) -> Option<TypeId> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let Parent::Stmt(owner) = bound.parent_of_stmt(left.some()?) else {
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
                self.check_expression_in_flow_loop(file, expr);
                let iterable = self.non_nullable_type_if_needed(iterable);
                Some(self.iterated_type(iterable, is_await))
            }
            _ => None,
        }
    }

    /// True if `target` is the `k` in `for (const k in x)`, where `x` is the reference or an access
    /// chain that contains it.
    fn is_for_in_over(&mut self, reference: &Reference, target: FlowTarget) -> bool {
        let FlowTarget::Var(d) = target else {
            return false;
        };
        let (hir, bound) = (self.hir(reference.file), self.bound(reference.file));
        let stmt = bound.var_stmt[d.idx()];
        if stmt.is_some()
            && let Parent::Stmt(owner) = bound.parent_of_stmt(stmt)
            && let StmtKind::ForIn { left, expr, .. } = hir[owner].kind
            && left == stmt
        {
            return self.matches(reference, expr)
                || !is_parenthesized(hir, expr) && self.optional_chain_contains(reference, expr);
        }
        false
    }

    /// True if `expr`, which is `a.push(x)` or `a[i] = x`, mutates the reference. `(a.push)(x)` and
    /// `(a[i]) = x` aren't array mutations (`bindCallExpressionFlow`, `bindBinaryExpressionFlow`).
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

    /// `getTypeAtFlowArrayMutation`. Returns the array `ty` after the mutation `expr`.
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
                let index = self.context_free_type_of_expression(file, index);
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

    /// `getTypeOfDottedName`. Returns `e`'s type as determined by annotations only, without
    /// inference.
    pub(super) fn explicit_type(
        &mut self,
        file: FileId,
        e: ExprId,
        mut diagnostic: Option<&mut Reported>,
    ) -> Option<TypeId> {
        let hir = self.hir(file);
        if hir.is_in_with(hir[e].pos) {
            return None;
        }
        match hir[e].kind {
            ExprKind::Ident(name) => {
                let sym = self.symbol_of_identifier(file, e, name)?;
                self.explicit_type_of_symbol(sym, diagnostic)
            }
            ExprKind::This => self.explicit_this_type(file, e),
            // `checkSuperExpression`
            ExprKind::Super => Some(self.type_of_expr(file, e)),
            ExprKind::Dot { obj, name, .. } => {
                let obj = self.explicit_type(file, obj, diagnostic.as_deref_mut())?;
                let name = if is_private_name_at(hir, hir.name_pos(e)) {
                    self.private_name_in_symbol_of_type(obj, name)?
                } else {
                    name
                };
                self.explicit_type_of_property(obj, name, diagnostic)
            }
            _ => None,
        }
    }

    /// `GetSymbolNameForPrivateIdentifier(t.symbol, name.Text())`, which isn't the `#name` that's
    /// in scope. Returns `None` if `t.symbol` isn't a class that declares a `#name`, so no type has
    /// a property of that name.
    fn private_name_in_symbol_of_type(&self, t: TypeId, name: Atom) -> Option<Atom> {
        let Some(super::errors_small::SymbolAtLocation::Symbol(symbol)) = self.symbol_of_type(t)
        else {
            return None;
        };
        let private_text = self.written_name(name);
        let declarations = self.files().decls_of(symbol);
        declarations.iter().find_map(|&(file, declaration)| {
            let Decl::Class(class) = declaration else {
                return None;
            };
            let hir = self.hir(file);
            hir[class].members.iter().find_map(|m| match hir[m].key {
                PropKey::Private(key) if self.written_name(key) == private_text => Some(key),
                _ => None,
            })
        })
    }

    /// `getExplicitTypeOfSymbol(getPropertyOfType(obj, name), diagnostic)`
    fn explicit_type_of_property(
        &mut self,
        obj: TypeId,
        name: Atom,
        diagnostic: Option<&mut Reported>,
    ) -> Option<TypeId> {
        let (prop, mapper) = self.get_property_of_type(obj, name)?;
        (self.has_explicit_type(prop, diagnostic)).then(|| self.type_of_prop(prop, mapper))
    }

    /// True if `getExplicitTypeOfSymbol` returns `prop`'s type.
    fn has_explicit_type(&mut self, prop: &Prop, diagnostic: Option<&mut Reported>) -> bool {
        if prop.flags.contains(PropFlags::ACCESSOR) {
            return false;
        }
        let is_annotated = match &prop.source {
            // `Arg::Prop` prints the name of a member.
            PropSource::Symbol(sym) if diagnostic.is_some() && self.is_member_symbol(*sym) => {
                self.explicit_type_of_symbol(*sym, None).is_some()
            }
            PropSource::Symbol(sym) => {
                return self.explicit_type_of_symbol(*sym, diagnostic).is_some();
            }
            // `SymbolFlagsMethod`. No other member has a type annotation.
            PropSource::Literal(f, p) => self.hir(*f)[*p].kind == PropKind::Method,
            // No `ValueDeclaration`.
            PropSource::Mapped(mapped_type, ..) => {
                let origin = self.synthetic_origin(*mapped_type, prop);
                return origin.is_some_and(|origin| self.has_explicit_type(origin, diagnostic));
            }
            // It has the first one's `ValueDeclaration` and flags.
            PropSource::Copy(_, copied, true) => {
                let first = copied.first();
                return first.is_some_and(|first| self.has_explicit_type(first, diagnostic));
            }
            PropSource::Intersected(_, parts) => {
                // `createUnionOrIntersectionProperty`, `isInstantiation`: instantiations of one
                // property that have the same type are that property.
                let (single, others) = (&parts[0], &parts[1..]);
                if others.iter().all(|other| other.source == single.source) {
                    let ty = self.type_of_prop(single, MapperId::IDENTITY);
                    if (others.iter())
                        .all(|other| self.type_of_prop(other, MapperId::IDENTITY) == ty)
                    {
                        return self.has_explicit_type(single, diagnostic);
                    }
                }
                // `SymbolFlagsProperty`, even if all are methods.
                (self.value_declaration_of_prop(prop)).is_some_and(|(f, declaration)| {
                    self.is_declaration_with_explicit_type_annotation(f, declaration)
                })
            }
            // No `ValueDeclaration`.
            PropSource::Type(_) | PropSource::Copy(_, _, false) | PropSource::ReverseMapped(..) => {
                return false;
            }
        };
        if !is_annotated
            && let Some(diagnostic) = diagnostic
            && let Some((f, declaration)) = self.value_declaration_of_prop(prop)
            && let Some(at) = self.error_span_of_declaration(f, declaration)
        {
            diagnostic.add_related_info(self.new_diagnostic(at, 2782, &[Arg::Prop(prop)]));
        }
        is_annotated
    }

    /// `isDeclarationWithExplicitTypeAnnotation`
    fn is_declaration_with_explicit_type_annotation(&self, f: FileId, declaration: Decl) -> bool {
        let (hir, bound) = (self.hir(f), self.bound(f));
        match declaration {
            Decl::Var(pat) | Decl::Param(pat) => {
                bound.pat_parent[pat.idx()].has_type_annotation(hir)
            }
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

    /// `getExplicitTypeOfSymbol`. `has_explicit_type` handles the properties that have no `Sym`.
    fn explicit_type_of_symbol(
        &mut self,
        sym: Sym,
        diagnostic: Option<&mut Reported>,
    ) -> Option<TypeId> {
        // `for (var a of b) for (var b of a)`
        if self.is_stack_low() {
            return None;
        }
        let Some(sym) = self.files().resolve_alias_if_needed(sym) else {
            // `resolveSymbol`: a target that isn't in the symbol tables is a property.
            let AliasTarget::Property(obj, name, _) = self.resolve_alias(sym) else {
                return None;
            };
            return self.explicit_type_of_property(obj, name, diagnostic);
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
        // The result is the variable's type, so an optional parameter may be `undefined`.
        if self.is_declaration_with_explicit_type_annotation(f, declaration) {
            return Some(self.type_of_symbol(sym));
        }
        // The variable in `for (const f of fs)` has `fs`'s element type, as far as annotations
        // determine the type of `fs`.
        let (hir, bound) = (self.hir(f), self.bound(f));
        if let Decl::Var(pat) = declaration
            && let PatParent::Var(d) = bound.pat_parent[pat.idx()]
        {
            let stmt = bound.var_stmt[d.idx()];
            if stmt.is_some()
                && let Parent::Stmt(owner) = bound.parent_of_stmt(stmt)
                && let StmtKind::ForOf {
                    left,
                    expr,
                    is_await,
                    ..
                } = hir[owner].kind
                && left == stmt
                && let Some(iterable) = self.explicit_type(f, expr, None)
            {
                let usage = if is_await {
                    super::symbols::IterationUse::ForAwaitOfInFlow
                } else {
                    super::symbols::IterationUse::ForOfInFlow
                };
                let element =
                    self.iterated_type_or_element_type(usage, iterable, TypeId::UNDEFINED, None);
                return Some(element.unwrap_or(TypeId::ANY));
            }
        }
        if let Some(diagnostic) = diagnostic
            && let Some(at) = self.error_span_of_declaration(f, declaration)
        {
            diagnostic.add_related_info(self.new_diagnostic(at, 2782, &[Arg::Sym(sym)]));
        }
        None
    }

    /// `getExplicitThisType`: the declared type of `this`. Nothing is narrowed.
    fn explicit_this_type(&mut self, file: FileId, e: ExprId) -> Option<TypeId> {
        let (class, is_static) = match self.this_container(file, e)? {
            Err(class_container) => class_container,
            Ok(func) => {
                let this_ty = self.hir(file)[func].this_ty(self.hir(file));
                if this_ty.is_some() {
                    return Some(self.type_from_node(file, this_ty));
                }
                // `getExplicitTypeOfSymbol(signature.thisParameter)`: a `this` parameter without a
                // type annotation has no explicit type, and the class isn't consulted.
                if self.hir(file)[func].this_param.is_some() {
                    return None;
                }
                // `assignContextualParameterTypes` gives a function without a `this` parameter a
                // copy of its contextual signature's, which has the original's declaration:
                // `this: T`.
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

    /// The `getResolvedSignature` branch of `getEffectsSignature`. tsgo caches the result
    /// unconditionally, including resolutions made during the analysis of a flow loop or inside a
    /// cycle, where the resolved signature itself isn't cached. Without this cache every visit of a
    /// condition or call node resolves the call again, which is exponential in the number of guard
    /// and assertion calls.
    fn resolved_effects_signature(&mut self, file: FileId, call: ExprId) -> Option<SigId> {
        if let Some(cached) = (self.p.resolved_effects_signatures).get(&self.task, &(file, call)) {
            return cached;
        }
        let resolved = self.resolved_signature(file, call);
        // `UNRESOLVED` means the query hit the depth or stack limit.
        if resolved.ret != TypeId::UNRESOLVED {
            let (key, stored) = ((file, call), Stored::new());
            (self.p.resolved_effects_signatures).rewrite(&self.task, key, resolved.sig, stored);
        }
        resolved.sig
    }

    /// `getEffectsSignature` for the call of a `Flow::Call` node.
    pub(super) fn effects_signature(&mut self, file: FileId, call: ExprId) -> Option<SigId> {
        self.effects_signature_and_is_cached(file, call).0
    }

    /// `effects_signature`, plus whether the result is cached in `effects_signatures`.
    fn effects_signature_and_is_cached(
        &mut self,
        file: FileId,
        call: ExprId,
    ) -> (Option<SigId>, bool) {
        if let Some(known) = self.p.effects_signatures.get(&self.task, &(file, call)) {
            return (known, true);
        }
        let begun = self.begin_effects_signature();
        let mut required_resolution = false;
        let (sig, _) = self
            .run_memoizable(|c| c.effects_signature_uncached(file, call, &mut required_resolution));
        let is_cached = self.assign_effects_signature(file, call, sig, begun, required_resolution);
        (sig, is_cached)
    }

    /// Starts an evaluation of `getEffectsSignature`. Returns the state `assign_effects_signature`
    /// needs: `work`, `cycles`, `limits`, and whether a query of the task had re-entered itself.
    /// That last flag is cleared so the evaluation records its own.
    fn begin_effects_signature(&mut self) -> (u64, u64, u64, bool) {
        let closed_a_cycle = std::mem::take(&mut self.task.closed_a_cycle);
        (self.work, self.cycles, self.limits, closed_a_cycle)
    }

    /// `links.effectsSignature = signature` in `getEffectsSignature`. It's assigned even from a
    /// loop's incomplete type, and it overwrites what a nested evaluation assigned. Returns false
    /// and stores nothing if a query was rejected where tsgo has a result.
    fn assign_effects_signature(
        &mut self,
        file: FileId,
        node: ExprId,
        sig: Option<SigId>,
        (work, cycles, limits, closed_a_cycle): (u64, u64, u64, bool),
        required_resolution: bool,
    ) -> bool {
        let is_circular = self.task.closed_a_cycle;
        self.task.closed_a_cycle |= closed_a_cycle;
        // Native stack or query depth ran out, a limit was hit that is reported from elsewhere,
        // or the resolution of the call has no result.
        let is_cut_short = self.rejected_at >= work && self.cycles != cycles
            || self.limits != limits
            || required_resolution
                && (self.p.resolved_effects_signatures)
                    .get(&self.task, &(file, node))
                    .is_none();
        if is_circular || is_cut_short || self.is_stack_low() {
            return false;
        }
        (self.p.effects_signatures).rewrite(&self.task, (file, node), sig, Stored::new());
        true
    }

    /// FOR SPEED. Follows a walk from `before`, the antecedent of the idle call `flow`, through the
    /// idle calls that only one node follows. Returns where it ends up and how many calls it
    /// passed. Idle calls don't affect any walk. Each reference in n consecutive call statements
    /// walks back through the ones before it. To keep that from taking n * n steps, the result is
    /// cached at the call where a long run was entered, and the next walk enters right after that
    /// call.
    fn before_idle_calls(&mut self, file: FileId, flow: FlowId, before: FlowId) -> (FlowId, u32) {
        const LONG: u32 = 32;
        let bound = self.bound(file);
        let memo = &mut self.flow_memo;
        let (mut at, mut passed) = (before, 0u32);
        while let Flow::Call { before, .. } = bound.flow[at.idx()]
            && memo.is_idle_call(file, at)
            && !bound.is_shared(at)
        {
            // An idle call may have appeared since at the node where a cached run ended.
            (at, passed) = match memo.idle_runs.get(at.idx()) {
                Some(&(arrived_at, more)) if more != 0 => (arrived_at, passed + 1 + more),
                _ => (before, passed + 1),
            };
        }
        if passed > LONG {
            if memo.idle_runs.is_empty() {
                memo.idle_runs.resize(bound.flow.len(), (FlowId::NONE, 0));
            }
            memo.idle_runs[flow.idx()] = (at, passed);
        }
        (at, passed)
    }

    /// Records that `effects_signatures` has an entry for the flow node `flow`'s call. `is_idle`
    /// means the entry is `None`.
    #[inline(never)]
    fn note_settled_call(&mut self, file: FileId, flow: FlowId, is_idle: bool) {
        // Nearly all walks are in the task's file.
        if self.task.file != Some(file) {
            return;
        }
        let words = self.bound(file).flow.len() / 64 + 1;
        let memo = &mut self.flow_memo;
        if memo.settled_calls_of != Some(file) {
            memo.settled_calls_of = Some(file);
            memo.settled_calls.clear();
            memo.settled_calls.resize(words, (0, 0));
            memo.idle_runs.clear();
        }
        let (word, bit) = (flow.idx() / 64, 1 << (flow.idx() % 64));
        memo.settled_calls[word].0 |= bit;
        if is_idle {
            memo.settled_calls[word].1 |= bit;
        }
    }

    /// `required_resolution` is set if the result is only as cacheable as the call's resolution,
    /// which tracks that itself.
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
        let callee = hir[c].callee;
        // "A call expression parented by an expression statement is a potential assertion. Other
        // call expressions are potential type predicate function calls."
        let func_type = if hir.kind(hir.parent(hir.node(call))) == Kind::ExpressionStatement {
            self.explicit_type(file, callee, None)?
        } else if matches!(hir[callee].kind, ExprKind::Super) {
            return None;
        } else {
            // `checkNonNullType(getOptionalExpressionType(..))`, `checkNonNullExpression`
            let ty = self.chain_receiver(file, callee, hir[c].chain).0;
            self.check_non_null_type(file, callee, ty)
        };
        self.effects_signature_of_function_type(file, call, func_type, required_resolution)
    }

    /// The end of `getEffectsSignature`, once it has `funcType`.
    fn effects_signature_of_function_type(
        &mut self,
        file: FileId,
        call: ExprId,
        func_type: TypeId,
        required_resolution: &mut bool,
    ) -> Option<SigId> {
        let sigs = self.signatures(func_type, false);
        let sig = match sigs[..] {
            [only] if self.sig_type_params(only).is_empty() => only,
            _ => {
                if !(sigs.iter()).any(|&s| self.has_type_predicate_or_never_return_type(s)) {
                    return None;
                }
                *required_resolution = true;
                self.resolved_effects_signature(file, call)?
            }
        };
        self.has_type_predicate_or_never_return_type(sig)
            .then_some(sig)
    }

    /// `hasTypePredicateOrNeverReturnType`
    fn has_type_predicate_or_never_return_type(&mut self, sig: SigId) -> bool {
        if self.sig_predicate(sig).is_some() {
            return true;
        }
        let Some((file, func, _)) = self.sig_decl(sig) else {
            return false;
        };
        // `getReturnTypeFromAnnotation`
        let ret = self.hir(file)[func].ret;
        ret.is_some()
            && match self.hir(file)[ret].kind {
                TypeNodeKind::Predicate { .. } => false,
                TypeNodeKind::Keyword(keyword) => keyword == Keyword::Never,
                _ => self.type_from_node(file, ret).is_never(),
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
                self.apply_predicate(reference, ty, predicate, c, true)
            }
            _ => ty,
        }
    }

    /// `isReachableFlowNode`
    pub(super) fn is_reachable(&mut self, file: FileId, flow: FlowId) -> bool {
        let reachable = self.is_reachable_worker(file, flow, &mut Vec::new());
        self.last_flow_node = (file, flow, reachable);
        reachable
    }

    /// `isReachableFlowNodeWorker`
    fn is_reachable_worker(
        &mut self,
        file: FileId,
        mut flow: FlowId,
        reduced: &mut Vec<(FlowId, FlowId)>,
    ) -> bool {
        let bound = self.bound(file);
        // TypeScript calls itself at a shared node and stores the result. A function with 30,000
        // statements has that many in a row, so here these invocations wait in a list, outermost
        // first.
        let mut shared: SmallVec<[(FlowId, Memoizable); 2]> = SmallVec::new();
        let reachable = loop {
            if (file, flow) == (self.last_flow_node.0, self.last_flow_node.1) {
                break self.last_flow_node.2;
            }
            if bound.is_shared(flow) {
                if let Some(cached_reachable) =
                    self.p.flow_node_reachable.get(&self.task, &(file, flow))
                {
                    break cached_reachable;
                }
                shared.push((flow, self.begin_memoizable()));
            }
            match bound.flow[flow.idx()] {
                Flow::Unreachable => break false,
                Flow::Start { .. } | Flow::StartInvoked { .. } => break true,
                Flow::Assign { before, .. }
                | Flow::Cond { before, .. }
                | Flow::ArrayMutation { before, .. } => flow = before,
                Flow::Call { before, call } => {
                    let sig = if self.flow_memo.is_idle_call(file, flow) {
                        None
                    } else {
                        let (sig, is_cached) = self.effects_signature_and_is_cached(file, call);
                        if is_cached {
                            self.note_settled_call(file, flow, sig.is_none());
                        }
                        sig
                    };
                    if let Some(sig) = sig
                        && (self.asserts_false_expression(file, call, sig)
                            || self.sig_return(sig).is_never())
                    {
                        break false;
                    }
                    flow = before;
                }
                Flow::Switch { before, stmt, from } => {
                    if from == Flow::NO_CLAUSE && self.is_exhaustive_switch(file, stmt) {
                        break false;
                    }
                    flow = before;
                }
                Flow::Reduce {
                    before,
                    label,
                    instead,
                } => {
                    if self.is_stack_low() {
                        break true;
                    }
                    // "Cache is unreliable once we start adjusting labels"
                    self.last_flow_node.1 = FlowId::NONE;
                    reduced.push((label, instead));
                    let reachable = self.is_reachable_worker(file, before, reduced);
                    reduced.pop();
                    break reachable;
                }
                Flow::Label { .. } => {
                    // One native frame per label. With `allowUnreachableCode: true` no earlier
                    // statement has filled the cache.
                    if self.is_stack_low() {
                        break true;
                    }
                    break branch_label_antecedents(bound, flow, reduced)
                        .iter()
                        .any(|&edge| self.is_reachable_worker(file, edge, reduced));
                }
                Flow::Loop { start, len } => match bound.edges(start, len).first() {
                    Some(&entry) => flow = entry,
                    None => break false,
                },
            }
        };
        while let Some((flow, begun)) = shared.pop() {
            if self.end_memoizable(begun).is_some() {
                (self.p.flow_node_reachable).rewrite(&self.task, (file, flow), reachable);
            }
        }
        reachable
    }

    /// `isPostSuperFlowNode`
    pub(super) fn is_post_super(
        &mut self,
        file: FileId,
        mut flow: FlowId,
        reduced: &mut Vec<(FlowId, FlowId)>,
    ) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // The shared nodes passed so far, which get the result stored. See `is_reachable_worker`.
        let mut shared: SmallVec<[FlowId; 8]> = SmallVec::new();
        let is_post_super = loop {
            if bound.is_shared(flow) {
                if let Some(&cached_post_super) =
                    self.flow_memo.flow_node_post_super.get(&(file, flow))
                {
                    break cached_post_super;
                }
                shared.push(flow);
            }
            match bound.flow[flow.idx()] {
                // Unreachable nodes are skipped.
                Flow::Unreachable => break true,
                Flow::Start { .. } | Flow::StartInvoked { .. } => break false,
                Flow::Assign { before, .. }
                | Flow::Cond { before, .. }
                | Flow::ArrayMutation { before, .. }
                | Flow::Switch { before, .. } => {
                    flow = before;
                }
                Flow::Call { before, call } => {
                    if matches!(hir[call].kind, ExprKind::Call(c) if matches!(hir[hir[c].callee].kind, ExprKind::Super))
                    {
                        break true;
                    }
                    flow = before;
                }
                // One native frame per label from here on.
                Flow::Reduce { .. } | Flow::Label { .. } if self.is_stack_low() => break true,
                Flow::Reduce {
                    before,
                    label,
                    instead,
                } => {
                    reduced.push((label, instead));
                    let is_post_super = self.is_post_super(file, before, reduced);
                    reduced.pop();
                    break is_post_super;
                }
                Flow::Label { .. } => {
                    break branch_label_antecedents(bound, flow, reduced)
                        .iter()
                        .all(|&edge| self.is_post_super(file, edge, reduced));
                }
                Flow::Loop { start, len } => match bound.edges(start, len).first() {
                    Some(&entry) => flow = entry,
                    None => break true,
                },
            }
        };
        for flow in shared {
            let post_super_cache = &mut self.flow_memo.flow_node_post_super;
            post_super_cache.insert((file, flow), is_post_super);
        }
        is_post_super
    }

    /// `checkExpressionCached`. Returns `e`'s type, computed with an empty `flowLoopStack` and an
    /// empty `flowTypeCache`. Only its callers read `links.resolvedType`, each once.
    /// `checkExpression` computes the type again.
    fn type_of_expr_outside_loops(&mut self, file: FileId, e: ExprId) -> TypeId {
        self.outside_flow_loops(|c| c.type_of_expr(file, e))
    }

    /// Runs `compute` with an empty `flowLoopStack` and an empty `flowTypeCache`, as in
    /// `checkExpressionCached`.
    pub(super) fn outside_flow_loops<R>(&mut self, compute: impl FnOnce(&mut Self) -> R) -> R {
        let loops = std::mem::take(&mut self.flow_loops);
        let cache = std::mem::take(&mut self.flow_type_cache);
        let depth = std::mem::replace(&mut self.flow_type_cache_depth, self.stack.len());
        let result = compute(self);
        self.flow_type_cache = cache;
        self.flow_type_cache_depth = depth;
        self.flow_loops = loops;
        result
    }

    /// `isExhaustiveSwitchStatement`
    fn is_exhaustive_switch(&mut self, file: FileId, stmt: StmtId) -> bool {
        let links = self.flow_memo.switch_statement_links.entry((file, stmt));
        let links = links.or_default();
        match links.exhaustive_state {
            ExhaustiveState::Unknown => links.exhaustive_state = ExhaustiveState::Computing,
            // "Resolve circularity to false"
            ExhaustiveState::Computing => {
                links.exhaustive_state = ExhaustiveState::False;
                return false;
            }
            state => return state == ExhaustiveState::True,
        }
        let depth = self.stack.len();
        self.flow_memo.exhaustive_states_computing.push(depth);
        let is_exhaustive = self.compute_exhaustive_switch_statement(file, stmt);
        self.flow_memo.exhaustive_states_computing.pop();
        let links = self.flow_memo.switch_statement_links.entry((file, stmt));
        let links = links.or_default();
        if links.exhaustive_state == ExhaustiveState::Computing {
            links.exhaustive_state = match is_exhaustive {
                Some(true) => ExhaustiveState::True,
                Some(false) => ExhaustiveState::False,
                None => ExhaustiveState::Unknown,
            };
        }
        links.exhaustive_state == ExhaustiveState::True
    }

    /// `computeExhaustiveSwitchStatement`. True if the cases cover every possible value of the
    /// `switch` expression. Returns `None` if a query was rejected, which never happens in tsgo.
    fn compute_exhaustive_switch_statement(&mut self, file: FileId, stmt: StmtId) -> Option<bool> {
        let hir = self.hir(file);
        let StmtKind::Switch { expr, cases } = hir[stmt].kind else {
            return Some(false);
        };
        if let ExprKind::Unary {
            op: UnOp::Typeof,
            operand,
        } = hir[expr].kind
            && !is_parenthesized(hir, expr)
        {
            let Some(witnesses) = self.switch_typeof_witnesses(file, cases) else {
                return Some(false);
            };
            let ty = self.type_of_expr_outside_loops(file, operand);
            let ty = self.base_constraint_of(ty).unwrap_or(ty);
            if ty == TypeId::UNRESOLVED {
                return None;
            }
            let not_equal = not_equal_facts_from_typeof_switch(&witnesses, 0, 0);
            // A type that can be anything is covered by all possible `typeof` results.
            if self.has_any_flag(ty) || ty == TypeId::UNKNOWN {
                return Some(facts::ALL_TYPEOF_NE & not_equal == facts::ALL_TYPEOF_NE);
            }
            // `someType` tests `never` itself, which has no facts: the condition holds vacuously.
            if ty.is_never() {
                return Some(not_equal != 0);
            }
            let parts = self.parts(ty);
            return Some(!(parts.iter()).any(|&m| self.type_facts(m, not_equal) == not_equal));
        }
        let ty = self.type_of_expr_outside_loops(file, expr);
        if ty == TypeId::UNRESOLVED {
            return None;
        }
        let ty = self.base_constraint_of(ty).unwrap_or(ty);
        // `isLiteralType`
        if !self.is_every_type_unit(ty) {
            return Some(false);
        }
        let switch_types = self.get_switch_clause_types(file, stmt);
        if switch_types.contains(&TypeId::UNRESOLVED) {
            return None;
        }
        let is_neither_unit_type_nor_never = |&t: &TypeId| !self.is_unit(t) && !t.is_never();
        if switch_types.is_empty() || switch_types.iter().any(is_neither_unit_type_nor_never) {
            return Some(false);
        }
        // `eachTypeContainedIn`: by type identity, not by comparability.
        Some(self.every_type(ty, |c, m| {
            switch_types.contains(&c.with_freshness(m, false))
        }))
    }

    // ───────────────────────────── the rest ─────────────────────────────

    /// `isInCompoundLikeAssignment`: `x = x + 1` is `x += 1` expanded, and a `0` isn't assumed to
    /// keep its literal type.
    pub(super) fn is_in_compound_like_assignment(&self, file: FileId, target: ExprId) -> bool {
        let hir = self.hir(file);
        // `IsAssignmentExpression(target, excludeCompoundAssignment)`
        if !matches!(
            self.bound(file).get_assignment_target(hir, target),
            Some(AssignmentTarget::Assign(None))
        ) {
            return false;
        }
        // `GetAssignmentTarget` passes no binary expression on its way to the one it returns.
        let parent = hir.parent(hir.node(target));
        let NodeData::Expr(assignment) =
            hir.data(hir.find_ancestor_kind(parent, Kind::BinaryExpression))
        else {
            return false;
        };
        // `isCompoundLikeAssignment`, `isShiftOperatorOrHigher`
        matches!(hir[assignment].kind, ExprKind::Assign { value, .. }
        if matches!(
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
        ))
    }

    /// `getTypePredicateFromBody`: `x => x.kind === "a"` is a type guard without declaring one.
    pub(super) fn inferred_predicate(&mut self, file: FileId, func: FnId) -> Option<Predicate> {
        let (body, before) = self.returned_expression_of_type_guard(file, func)?;
        if let Some(cached_predicate) = self
            .p
            .type_predicates_from_body
            .get(&self.task, &(file, func))
        {
            return cached_predicate;
        }
        // `sig.resolvedTypePredicate = c.noTypePredicate // avoid infinite loop`. A condition
        // evaluated below may call this function.
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

    /// True if every later `inferred_predicate` call for `func` returns the same result without
    /// computing anything.
    pub(super) fn is_inferred_predicate_settled(&self, file: FileId, func: FnId) -> bool {
        self.returned_expression_of_type_guard(file, func).is_none()
            || (self.p.type_predicates_from_body)
                .get(&self.task, &(file, func))
                .is_some()
                && !(self.flow_memo.type_predicates_in_progress).contains(&(file, func))
    }

    /// Runs the syntax checks at the start of `getTypePredicateFromBody`. Returns the only
    /// expression that `func` returns and the flow node at that point, which is `NONE` for the
    /// start of the function. Returns `None` if the syntax rules out a type predicate.
    fn returned_expression_of_type_guard(
        &self,
        file: FileId,
        func: FnId,
    ) -> Option<(ExprId, FlowId)> {
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
        Some(match f.body {
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
                let lacks_flow_node =
                    is_parenthesized(hir, e) && bound.flow_of_expr(e) == UNREACHABLE;
                (
                    e,
                    if lacks_flow_node {
                        FlowId::NONE
                    } else {
                        bound.flow_of_stmt(only)
                    },
                )
            }
            FnBody::None => return None,
        })
    }

    /// `checkExpressionCached(e)`, where `e` may be the body that `getReturnTypeFromBody` is
    /// checking for `contextuallyCheckFunctionExpressionOrObjectLiteralMethod`, which doesn't push
    /// a type resolution. `checkExpression` has no re-entrancy guard, so `e` is checked again, and
    /// the first in-progress resolution it reaches closes the cycle. From then on
    /// `links.resolvedType` has the result, for `getReturnTypeOfSignature` too, while the first
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
            event_bits: 1,
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
        // `fn.Parameters()` includes a `this` parameter. `signature.parameters` and a call's
        // arguments don't, but `parameterIndex` counts it anyway.
        let this = f.this_param.some();
        for (i, p) in this.into_iter().chain(f.params.iter()).enumerate() {
            let param = &hir[p];
            let declared = if p == f.this_param {
                self.type_of_this_parameter(file, func)
            } else {
                self.type_of_param(file, p)
            };
            let PatKind::Ident(name) = hir[param.pat].kind else {
                continue;
            };
            let symbol = bound.pat_symbol[param.pat.idx()];
            // `x is true` isn't useful.
            if self.is_boolean(declared)
                || self.is_symbol_assigned(file, symbol)
                || param.flags.contains(Flags::REST)
            {
                continue;
            }
            // `checkIfExpressionRefinesParameter`
            let (root, node) = (Root::Symbol(symbol), hir.node(param.pat));
            let reference = Reference::synthetic(file, root, SmallVec::new(), node);
            let outer = std::mem::replace(&mut self.walk_declared, declared);
            let when_true =
                self.param_type_after_test(&reference, declared, declared, before, body, true);
            // It has to be "if and only if": nothing of the narrowed type may fail the test.
            let leftover = if when_true == declared {
                when_true
            } else {
                let left = self
                    .param_type_after_test(&reference, declared, when_true, before, body, false);
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
                name,
                ty: Some(when_true),
                asserts: false,
            });
        }
        None
    }

    /// `getFlowTypeOfReference` for a parameter declared as `declared` whose type is `initial` at
    /// the start of its function, after the condition `test`, which is evaluated at `before`
    /// (`NONE` means the start of the function) with the outcome `sense`.
    fn param_type_after_test(
        &mut self,
        reference: &Reference,
        declared: TypeId,
        initial: TypeId,
        before: FlowId,
        test: ExprId,
        sense: bool,
    ) -> TypeId {
        if self.flow_analysis_disabled.contains(&reference.file) {
            return TypeId::ERROR;
        }
        self.flow_invocation_count += 1;
        let start = if before.is_none() {
            initial
        } else {
            let mut walk = Walk::new(reference.clone(), declared, initial, Crossing::No);
            // The invocation of `getTypeAtFlowNode` for the synthesized condition is in progress.
            walk.depth = 1;
            let ty = self.flow_type(&mut walk, before).ty;
            if walk.too_deep {
                self.disable_flow_analysis(reference.file);
                self.report_flow_control_error(reference);
                return TypeId::ERROR;
            }
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
