//! Narrowing: what a variable or a property is known to be at a place, going by the tests and assignments on the way there.

use super::decl::Predicate;
use super::*;
use crate::bind::{Decl, Flow, FlowId, FlowTarget, Parent, PatParent, SymbolId, UNREACHABLE};
use smallvec::{SmallVec, smallvec};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum Root {
    Symbol(SymbolId),
    /// A name nothing in the file declares.
    Global(Atom),
    This,
    Super,
    /// `import.meta`
    ImportMeta,
    /// `new.target`
    NewTarget,
    /// What a pattern destructures. Nothing is written that means it; tests of the variables the pattern binds narrow it.
    Pattern(PatId),
    /// All that a function is passed, where it is expected to take one rest parameter that is a union of tuples. Tests of its
    /// parameters narrow it.
    Params(FnId),
}

/// `x`, `this`, `x.a.b`: something whose type can be narrowed.
#[derive(Clone, Debug)]
pub(super) struct Reference {
    file: FileId,
    root: Root,
    path: SmallVec<[Atom; 4]>,
    /// Where it is written, if it is. Two that are written in different places are the same reference.
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

/// A variable without a declared type whose type at a place is what was last assigned on the way there.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum Auto {
    No,
    /// `let x`, `let x = null`
    Value,
    /// `let x = []`, `const x = []`
    Array,
}

/// Answers that hold whoever asks, kept by the checker that worked them out.
#[derive(Default)]
pub(super) struct FlowMemo {
    /// `getEffectsSignature`, by call.
    effects_signatures: FxHashMap<(FileId, ExprId), Option<SigId>>,
    /// The `Flow::Call` nodes of the file `idle_calls_of` for whose calls `effects_signatures` has `None`: a bit for each flow node.
    idle_calls: Vec<u64>,
    idle_calls_of: Option<FileId>,
    /// `getKeyPropertyName` and its map, by union and property name.
    key_properties: FxHashMap<(TypeId, Atom), Option<std::rc::Rc<FxHashMap<TypeId, TypeId>>>>,
    /// What each test of the file `tests_of` is about, by the flow node of the test.
    tests: Vec<About>,
    tests_of: Option<FileId>,
    /// The same for the tests of other files.
    other_tests: FxHashMap<(FileId, FlowId), About>,
    /// `getAssignmentReducedType`, by declared and assigned type.
    assignment_reduced_types: FxHashMap<(TypeId, TypeId), TypeId>,
    /// `getNarrowedType`, by type, candidate, `assumeTrue` and `checkDerived`.
    narrowed_types: FxHashMap<(TypeId, TypeId, bool, bool), TypeId>,
    /// `narrowTypeByEquality`, by the type, the type compared with as it is written, whether it is `==` that compares and whether
    /// they are equal.
    equal_types: FxHashMap<(TypeId, TypeId, bool, bool), TypeId>,
    /// `type_of_discriminant`, by the type, the name, `?.` and `!`.
    discriminant_types: FxHashMap<(TypeId, Atom, bool, bool), Option<(TypeId, bool)>>,
    /// `members_with_discriminant`, by the type, the name and what the property is narrowed to.
    discriminated_types: FxHashMap<(TypeId, Atom, TypeId), TypeId>,
}

impl FlowMemo {
    #[inline]
    fn is_idle_call(&self, file: FileId, flow: FlowId) -> bool {
        self.idle_calls_of == Some(file)
            && self.idle_calls[flow.idx() / 64] & 1 << (flow.idx() % 64) != 0
    }
}

/// Whether tests made outside a function still hold inside it.
#[derive(Copy, Clone)]
enum Crossing {
    No,
    Yes,
    /// They do if the variable is not assigned to any more once the expression has been reached. That is looked into where a walk
    /// gets to the start of a function.
    PastLastAssignment(SymbolId, ExprId),
}

/// What was found at labels.
#[derive(Default)]
struct Labels {
    few: SmallVec<[(FlowId, TypeId); 8]>,
    /// Those that came when `few` was full.
    many: FxHashMap<FlowId, TypeId>,
}

impl Labels {
    fn get(&self, label: FlowId) -> Option<TypeId> {
        match self.few.iter().find(|known| known.0 == label) {
            Some(known) => Some(known.1),
            None if self.many.is_empty() => None,
            None => self.many.get(&label).copied(),
        }
    }

    fn insert(&mut self, label: FlowId, ty: TypeId) {
        if let Some(known) = self.few.iter_mut().find(|known| known.0 == label) {
            known.1 = ty;
        } else if self.few.len() < self.few.inline_size() {
            self.few.push((label, ty));
        } else {
            self.many.insert(label, ty);
        }
    }
}

/// How far it is known what a walk starts from.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Start {
    /// From `Walk::initial`.
    Known,
    /// From `Walk::initial` if `assumes_initialized`, which has not been asked, and from `declared | undefined` otherwise.
    Unsettled,
    /// From `declared | undefined`, which is another type than `declared` and has not been made.
    Unassigned,
}

struct Walk {
    reference: Reference,
    declared: TypeId,
    /// What it is where the walk ends without having met an assignment. See `initial_of`.
    initial: TypeId,
    start: Start,
    auto: Auto,
    crossing: Crossing,
    labels: Labels,
    /// The `finally` blocks being gone back through: where each starts, and the label whose edges count instead.
    reduced: Vec<(FlowId, FlowId)>,
    /// Loops being worked out, and what has reached them so far.
    loops: SmallVec<[(FlowId, TypeId); 2]>,
    /// For each of `loops`: what was found at labels during this round, which holds as long as `loops` stays as it is.
    round_labels: Vec<Labels>,
    steps: u32,
    /// How many invocations of `getTypeAtFlowNode` would be under way, one inside the other.
    depth: u32,
    /// There were `MAX_FLOW_DEPTH` of them (`flowAnalysisDisabled`): the answer is errorType.
    too_deep: bool,
    /// `FlowType.incomplete`: the walk used the type of a loop that another walk is still analysing, or passed an assignment of
    /// `silentNeverType`. It is kept per walk, not per flow type, and only tells a `never` result from `silentNeverType`.
    incomplete: bool,
}

const MAX_STEPS: u32 = 2_000_000;

/// A number for a name or for `this`, which two of them may share. 0 for whatever else a reference can start with.
fn root_key(root: Root) -> u32 {
    match root {
        Root::Symbol(symbol) => symbol.0 << 2 | 1,
        Root::Global(name) => name.0 << 2 | 2,
        Root::This => 3,
        Root::Super | Root::ImportMeta | Root::NewTarget | Root::Pattern(_) | Root::Params(_) => 0,
    }
}

/// What a test can say something about.
#[derive(Copy, Clone, Default)]
struct About {
    /// 0: the test has not been looked into.
    state: u32,
    /// What `narrow` compares a reference with: the `root_key` of what each starts with, and the number of the property it goes on
    /// with plus one, `ALONE` if it does not go on, 0 if that cannot be told or makes no difference.
    chains: [(u32, u32); 3],
}

impl About {
    const ALONE: u32 = u32::MAX;
    const KNOWN: u32 = 1;
    /// There is more than `chains` holds, or a key that it takes asking to know the name of.
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

    /// Whether one of `chains` can be `reference`, go through it, or be what its last property is a property of.
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

/// `getTypeAtFlowNode`: the invocation that finds this many under way gives up.
const MAX_FLOW_DEPTH: u32 = 2000;

/// What `checkNonNullTypeWithReporter` reports.
#[derive(Copy, Clone)]
pub(super) enum NonNullError {
    /// 18046, 2571
    IsUnknown,
    /// `TypeFactsIsUndefined`, `TypeFactsIsNull`
    IsPossibly { undefined: bool, null: bool },
}

/// `TypeFacts`: the tests that come out true for some value of a type.
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
    /// What all but `undefined`, `null` and `void` have besides without strictNullChecks: `StringFacts` is `StringStrictFacts` and this.
    pub(super) const LOOSE: u32 = EQ_UNDEFINED | EQ_NULL | EQ_UNDEFINED_OR_NULL | FALSY;
    /// `BaseStringStrictFacts` and the like. Of symbols, objects and functions: `SymbolStrictFacts` and the like, without `Truthy`.
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
    /// `OrFactsMask`: what an intersection has if one of its members has it. It has the rest if all of them have it.
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

/// `getNotEqualFactsFromTypeofSwitch`: what holds where none of the clauses outside `from..to` was entered.
fn not_equal_facts_from_typeof_switch(witnesses: &[Atom], from: usize, to: usize) -> u32 {
    witnesses
        .iter()
        .enumerate()
        .filter(|&(i, name)| !(from..to).contains(&i) && name.is_some())
        .fold(0, |all, (_, &name)| all | typeof_ne_facts(name))
}

impl Walk {
    fn new(
        reference: Reference,
        declared: TypeId,
        initial: TypeId,
        auto: Auto,
        crosses_functions: bool,
    ) -> Walk {
        Walk {
            reference,
            declared,
            initial,
            start: Start::Known,
            auto,
            crossing: if crosses_functions {
                Crossing::Yes
            } else {
                Crossing::No
            },
            labels: Labels::default(),
            reduced: Vec::new(),
            loops: SmallVec::new(),
            round_labels: Vec::new(),
            steps: 0,
            depth: 0,
            too_deep: false,
            incomplete: false,
        }
    }

    fn known_at(&self, label: FlowId) -> Option<TypeId> {
        if !self.reduced.is_empty() {
            return None;
        }
        self.round_labels
            .iter()
            .rev()
            .find_map(|round| round.get(label))
            .or_else(|| self.labels.get(label))
    }

    fn remember(&mut self, label: FlowId, ty: TypeId) {
        if self.reduced.is_empty() {
            self.round_labels
                .last_mut()
                .unwrap_or(&mut self.labels)
                .insert(label, ty);
        }
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

impl<'p> Checker<'p> {
    /// The result of `work`, and whether it can go into `FlowMemo`: it holds whoever asks, and working it out again would raise
    /// none of the flags that relations, unions and intersections raise for their callers.
    fn run_memoizable<T>(&mut self, work: impl FnOnce(&mut Self) -> T) -> (T, bool) {
        let before = self.what_only_holds_for_now();
        let gave_up = std::mem::take(&mut self.relation_gave_up);
        let too_complex = std::mem::take(&mut self.relation_too_complex);
        let union_too_complex = std::mem::take(&mut self.union_too_complex);
        let reliability = std::mem::take(&mut self.reliability);
        let result = work(self);
        let is_memoizable = self.what_only_holds_for_now() == before
            && !self.relation_gave_up
            && !self.relation_too_complex
            && !self.union_too_complex
            && self.reliability == 0;
        self.relation_gave_up |= gave_up;
        self.relation_too_complex |= too_complex;
        self.union_too_complex |= union_too_complex;
        self.reliability |= reliability;
        (result, is_memoizable)
    }

    // ───────────────────────────── truthiness ─────────────────────────────

    /// What `getDefinitelyFalsyPartOfType` gives back as it is, `any` and `unknown` aside. `NaN` is not among it.
    fn is_definitely_falsy(&self, ty: TypeId) -> bool {
        match *self.data(ty) {
            // `void`, and `undefined` and `null` of whatever kind.
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
                .files()
                .atoms
                .bytes(text)
                .iter()
                .all(|&c| c == b'0' || c == b'n'),
            _ => false,
        }
    }

    /// `hasTypeFacts(ty, TypeFactsFalsy)`. `never` has no facts. Without strictNullChecks all else has this one.
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
                let zero = c.files().atoms.intern(b"0");
                c.intern(TypeData::BigIntLit {
                    text: zero,
                    negative: false,
                    fresh: false,
                })
            }
            TypeData::Intrinsic(
                Intrinsic::Any | Intrinsic::Error | Intrinsic::Unknown | Intrinsic::Unresolved,
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

    /// `getTypeFactsWorker`. Only what is in `mask` has to be right.
    fn type_facts_worker(&mut self, ty: TypeId, mask: u32) -> u32 {
        use facts::*;
        // What it extends leads back to it.
        if self.is_stack_low() {
            return OF_UNKNOWN;
        }
        let strict = self.p.files.options.strict_null_checks;
        let ty = self.force(ty);
        // What waits for type parameters goes by what it extends, and so does an intersection. A template that mentions no type
        // parameter extends itself.
        let ty = if self.is_deferred(ty)
            || self.is_intersection(ty)
            || self.is_instantiable(ty) && self.has_type_variables(ty)
        {
            let constraint = self.base_constraint_of(ty).unwrap_or(TypeId::UNKNOWN);
            self.force(constraint)
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
                    .files()
                    .atoms
                    .bytes(*text)
                    .iter()
                    .all(|&c| c == b'0' || c == b'n');
                of(OF_BIGINT, !is_zero, is_zero)
            }
            TypeData::BoolLit { value, .. } => of(OF_BOOLEAN, *value, !*value),
            TypeData::Intrinsic(Intrinsic::Void) => OF_VOID,
            TypeData::Intrinsic(
                Intrinsic::Undefined | Intrinsic::Missing | Intrinsic::UndefinedDeclared,
            ) => OF_UNDEFINED,
            TypeData::Intrinsic(Intrinsic::Null | Intrinsic::NullDeclared) => OF_NULL,
            TypeData::Intrinsic(Intrinsic::Symbol) | TypeData::UniqueSymbol { .. } => {
                of(OF_SYMBOL, true, false)
            }
            TypeData::Intrinsic(Intrinsic::Object) | TypeData::EvolvingArray(_) => {
                of(OF_OBJECT, true, false)
            }
            TypeData::Intrinsic(Intrinsic::Never) => 0,
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
                // It is looked into only as far as what is asked depends on what is in it.
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
            // It has every fact. What is intersected with `{}` below is `errorType` if it is an error type.
            let is_intersected = self.p.files.options.strict_null_checks
                && matches!(
                    include,
                    NE_UNDEFINED | NE_NULL | NE_UNDEFINED_OR_NULL | TRUTHY
                );
            return if is_intersected && self.is_error_type(ty) {
                TypeId::ERROR
            } else {
                ty
            };
        }
        let strict = self.p.files.options.strict_null_checks;
        let reduced = if strict && ty == TypeId::UNKNOWN {
            // `unknownUnionType`: `unknown` is `{} | null | undefined`, and is `unknown` again if none of them goes.
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

    /// `removeNullableByIntersection`: what may still turn out to be the one that is ruled out (`target`) is that and `{}`, or that
    /// and `{} | other_ty` if it may turn out to be the other one and `ty` does not say so as it is.
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
                ExprKind::NewTarget => break Root::NewTarget,
                ExprKind::Dot { obj, name, .. } => {
                    path.push(name);
                    at = obj;
                }
                ExprKind::Index { obj, index, .. } => {
                    path.push(self.access_key(file, index)?);
                    at = obj;
                }
                ExprKind::NonNull(x) => at = x,
                // `isMatchingReference` looks through these where they are in what is narrowed. `writeFlowCacheKey` knows neither.
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

    /// `tryGetElementAccessExpressionName`: the property `a[index]` names, if the syntax says, or a constant that stands for one name
    /// does. A key in parentheses of its own says nothing.
    fn literal_key(&mut self, file: FileId, index: ExprId) -> Option<Atom> {
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
                // Without a value written out it goes by its name, not by the number it gets.
                if member.init.is_none() {
                    return Some(member.name);
                }
                let ty = self.type_of_expr(of, member.init);
                self.property_name_of_type(ty)
            }
            Decl::Var(pat) => {
                // Not what a pattern binds.
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
                // What another file declares counts as declared.
                if init.is_none()
                    || of == file && !self.is_const_declared_before_use(file, node, pat, d)
                {
                    return None;
                }
                // `getTypeOfExpression` of the initializer, even next to an annotation that names nothing. It pushes no resolution of
                // the constant and is not widened. The declaration makes the unique symbol of `Symbol()`, from the syntax alone
                // (`getESSymbolLikeTypeForNode`).
                let ty = if annotation.is_some() {
                    self.type_of_expr(of, init)
                } else if self.is_symbol_or_symbol_for_call(of, init) {
                    self.type_of_symbol(sym)
                } else {
                    self.type_of_declaration_initializer(of, init)
                };
                self.property_name_of_type(ty)
            }
            _ => None,
        }
    }

    /// What tells `a[index]` from `a[other]`: the name, or else the variable, if it holds the same key all along.
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
        // `isMatchingReference`: a constant, or a parameter, what `catch` binds or a local `let` that nothing assigns to. No property
        // is called what comes of it.
        let symbol = self.bound(file).expr_symbol[index.idx()];
        if symbol.is_none() {
            // A constant of another script or of the library.
            let sym = self
                .files()
                .global(name, SymFlags::VALUE)
                .filter(|&sym| self.files().flags(sym).contains(SymFlags::CONST))?;
            return Some(
                self.files()
                    .atoms
                    .intern(format!("\0{}.{}", sym.file.0, sym.id.0).as_bytes()),
            );
        }
        if !matches!(
            self.bound(file).symbols[symbol.idx()].decls.first(),
            Some(Decl::Var(_) | Decl::Param(_))
        ) || !self.is_constant_name(file, symbol)
        {
            return None;
        }
        // A zero byte, and the number of the symbol in decimal.
        let mut key = [0u8; 11];
        let mut from = key.len();
        let mut number = symbol.0;
        loop {
            from -= 1;
            key[from] = b'0' + (number % 10) as u8;
            number /= 10;
            if number == 0 {
                break;
            }
        }
        Some(self.files().atoms.intern(&key[from - 1..]))
    }

    /// Whether `e` is the first `len` steps of `reference`. `isMatchingReference`, with `e` for the target: `satisfies` is looked
    /// through in the reference only.
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
                ExprKind::NewTarget => return remaining == 0 && reference.root == Root::NewTarget,
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

    fn matches(&mut self, reference: &Reference, e: ExprId) -> bool {
        self.matches_prefix(reference, reference.path.len(), e)
    }

    /// Whether an entry of `flow_loops` pushed when `stack` had `depth` frames is on `flowLoopStack` now. `checkExpressionCached`
    /// empties `flowLoopStack`, and it computes what a resolution caches: a resolution entered since the push hides the entry.
    fn is_flow_loop_visible(&self, depth: usize) -> bool {
        !self.stack[depth.min(self.stack.len())..]
            .iter()
            .any(|&q| self.is_resolution(q))
    }

    /// Whether `e`, whose `Query::Expr` is `stack[since]`, is the reference of a visible loop whose back edges are being analysed
    /// since then. `getTypeOfExpression` checks such a reference again, and the new analysis ends at the loop.
    pub(super) fn is_reference_of_loop_under_way(
        &mut self,
        file: FileId,
        e: ExprId,
        since: usize,
    ) -> bool {
        if self.flow_depth > 12 {
            return false;
        }
        for i in (0..self.flow_loops.len()).rev() {
            let depth = self.flow_loops[i].5;
            if depth <= since || !self.is_flow_loop_visible(depth) {
                break;
            }
            if self.flow_loops[i].1.file == file {
                let reference = self.flow_loops[i].1.clone();
                if self.matches(&reference, e) {
                    return true;
                }
            }
        }
        false
    }

    /// Whether `e` is something `reference` goes through: `x` or `x.a` for `x.a.b`.
    fn is_proper_prefix(&mut self, reference: &Reference, e: ExprId) -> bool {
        (0..reference.path.len()).any(|len| self.matches_prefix(reference, len, e))
    }

    /// Whether `e` is `reference?.a.b`: if it has a value, so has the reference.
    fn optional_chain_contains(&mut self, reference: &Reference, e: ExprId) -> bool {
        self.optional_chain_contains_reference(reference, e, true)
    }

    /// `optionalChainContainsReference`. `names_keys`: whether `isMatchingReference` is asked, which names the keys of the links.
    fn optional_chain_contains_reference(
        &mut self,
        reference: &Reference,
        e: ExprId,
        names_keys: bool,
    ) -> bool {
        let hir = self.hir(reference.file);
        // `matches` names the keys itself for a reference with a path. Nearly all callers in flow.go test `strictNullChecks` first.
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
            // `isMatchingReference` has the link for its source and the reference for its target here: `getAccessedPropertyName`
            // names the key of an element access before the target is looked at. `x!` is a link only inside a chain.
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
    /// `e` as an access to a property of the reference that tells the members of its union apart.
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
        // Going by the declared type keeps a property a discriminant after the members that made it one are gone.
        let declared_parts = self.parts(declared);
        let is_subset = is_declared_union
            && (ty == declared || self.parts(ty).iter().all(|m| declared_parts.contains(m)));
        let of = if is_subset { declared } else { ty };
        self.is_discriminant_property(of, access.name)
            .then_some(access)
    }

    /// Whether the members of the union `ty` have different types for `name`, one of them at least made of single values.
    pub(super) fn is_discriminant_property(&mut self, ty: TypeId, name: Atom) -> bool {
        if let Some(&known) = self.discriminants.get(&(ty, name)) {
            return known;
        }
        let is_shared = !ty.is_local();
        if is_shared && let Some(known) = self.p.discriminants.get(&(ty, name)) {
            self.discriminants.insert((ty, name), known);
            return known;
        }
        let held = self.what_only_holds_for_now();
        let result = self.is_discriminant_property_uncached(ty, name);
        if self.cycles == held.0 {
            self.discriminants.insert((ty, name), result);
        }
        if is_shared && self.what_only_holds_for_now() == held {
            self.p.discriminants.insert((ty, name), result);
        }
        result
    }

    /// `isDiscriminantProperty`, of what `createUnionOrIntersectionProperty` makes of the properties the members have.
    fn is_discriminant_property_uncached(&mut self, ty: TypeId, name: Atom) -> bool {
        let parts = self.parts(ty);
        let mut types: SmallVec<[TypeId; 8]> = SmallVec::new();
        let (mut literal, mut is_restricted) = (false, false);
        for &m in parts {
            let apparent = self.apparent_type(m);
            // `getPropertyOfType` reduces first: what nothing can be has no properties.
            if self.is_never_intersection(apparent) {
                continue;
            }
            let Some((prop, mapper)) = self.prop_ref(apparent, name) else {
                continue;
            };
            is_restricted |= prop
                .flags
                .intersects(PropFlags::PRIVATE | PropFlags::PROTECTED);
            let t = self.type_of_prop(prop, mapper);
            literal |= t == TypeId::BOOLEAN
                || t != TypeId::NEVER && self.every_type(t, |c, p| c.is_unit(p))
                || self.is_pattern_literal(t);
            types.push(t);
        }
        literal
            && types.iter().any(|&t| t != types[0])
            && !types.iter().any(|&t| self.is_generic(t))
            // What is private or protected in one member, and missing or declared elsewhere in another, is no property of the union.
            && !(is_restricted && self.is_hidden_in_union(parts, name))
    }

    /// `getCandidateDiscriminantPropertyAccess`: `x.kind`, `x["kind"]` or a name that stands for one. `x.kind!` is none of them.
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
        // `getDiscriminantPropertyAccess` asks `getAccessedPropertyName` of a candidate only: naming a constant key resolves a type.
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

    /// The variable `e` standing for a property of the reference: `const k = x.kind`, `const { kind: k } = x`,
    /// or bound by the pattern, or a parameter of the function, that is the reference.
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
                // `getAccessedPropertyName`: its place among the parameters, of which a `this` parameter is one, though the tuples
                // have nothing for it.
                PatParent::Param(p)
                    if bound.param_fn[p.idx()] == func
                        && hir[p].default.is_none()
                        && !hir[p].flags.contains(Flags::REST) =>
                {
                    let place = p.0 - hir[func].params.start + hir[func].this_ty.is_some() as u32;
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

    /// Whether the pattern `pat` is part of is never bound anew: of a `const`, or of a parameter nothing assigns to.
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

    /// `isConstantReference`: whether what the reference means cannot have changed since a test of it was stored in a constant.
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
        // `a.b.c`: nothing can be put in the `b` of `a`, or in the `c` of that.
        if !reference.path.is_empty() {
            let file = reference.file;
            let hir = self.hir(file);
            if reference.at.is_none() {
                return false;
            }
            // Written just so: `a!.b`, `(a).b` and `(f(), a).b` are none of what it knows.
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

    /// `isConstantReference` of a name: a constant, a parameter or a local `let` that nothing assigns to, the name a function
    /// expression gives itself. What is exported where it is declared is none of them: the name in the file stands for the
    /// export, which is not looked through.
    pub(super) fn is_constant_name(&self, file: FileId, symbol: SymbolId) -> bool {
        use crate::bind::Parent;
        let (hir, bound) = (self.hir(file), self.bound(file));
        let s = &bound.symbols[symbol.idx()];
        let is_assigned = s.flags.contains(SymFlags::ASSIGNED);
        match s.decls.first() {
            Some(&(Decl::Var(pat) | Decl::Param(pat))) => {
                let mut root = pat;
                loop {
                    match bound.pat_parent[root.idx()] {
                        PatParent::Prop(parent, _) | PatParent::Elem(parent, _) => root = parent,
                        PatParent::Param(_) => return !is_assigned,
                        PatParent::Var(d) => {
                            if hir[d].flags.contains(Flags::EXPORT) {
                                return false;
                            }
                            let stmt = bound.var_stmt[d.idx()];
                            if stmt.is_some() && matches!(hir[stmt].kind, StmtKind::Try { .. }) {
                                return !is_assigned;
                            }
                            return match hir[d].kind {
                                VarKind::Const | VarKind::Using | VarKind::AwaitUsing => true,
                                VarKind::Let => {
                                    let is_global = !self.files().modules[file.idx()].is_module()
                                        && stmt.is_some()
                                        && matches!(bound.stmt_parent[stmt.idx()], Parent::File);
                                    // `isSymbolAssigned`: what `export { x }` names counts as assigned to.
                                    !is_global
                                        && !is_assigned
                                        && (hir.exports.is_empty()
                                            || !self.is_named_by_export_specifier(file, symbol))
                                }
                                VarKind::Var => false,
                            };
                        }
                        PatParent::None => return false,
                    }
                }
            }
            Some(&Decl::Fn(f)) => hir[f].kind == FnKind::Expr,
            _ => false,
        }
    }

    /// `isReadonlySymbol` of the property `name` of `object`: in a union one member that says so will do.
    fn is_readonly_property(&mut self, object: TypeId, name: Atom) -> bool {
        if self.is_union(object) {
            let (mut is_readonly, mut is_declared) = (false, false);
            for &part in self.parts(object) {
                let part = self.apparent_type(part);
                if let Some((prop, _)) = self.prop_ref(part, name) {
                    is_declared = true;
                    is_readonly |= prop.flags.contains(PropFlags::READONLY);
                    continue;
                }
                // A member that has it by an index signature has it the way the signature says.
                let Some(members) = self.members(part) else {
                    return false;
                };
                let is_numeric = self.is_numeric_name(name);
                let mut covered = false;
                for info in &members.shape().index {
                    if info.key == TypeId::STRING || info.key == TypeId::NUMBER && is_numeric {
                        covered = true;
                        is_readonly |= info.readonly;
                    }
                }
                if !covered && !self.is_closed_object_literal_type(part) {
                    return false;
                }
            }
            return is_declared && is_readonly;
        }
        self.prop_ref(object, name)
            .is_some_and(|(prop, _)| prop.flags.contains(PropFlags::READONLY))
    }

    /// `getNarrowedTypeOfSymbol`. The type of a variable bound by a pattern that destructures a union, at `e`: tests of the other
    /// variables of the pattern say which member of the union it was.
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
        if len < 2
            || flow == UNREACHABLE
            || self.flow_depth > 12
            || !self.is_constant_pattern(file, parent)
        {
            return declared;
        }
        let parent_ty = self.type_of_pat(file, parent);
        let parent_ty = self.map_type(parent_ty, |c, m| {
            if c.is_deferred(m) {
                c.base_constraint(m)
            } else {
                m
            }
        });
        if !self.is_union(parent_ty) {
            return declared;
        }
        let reference = Reference {
            file,
            root: Root::Pattern(parent),
            path: SmallVec::new(),
            at: ExprId::NONE,
            has_key: true,
        };
        let mut walk = Walk::new(reference, parent_ty, parent_ty, Auto::No, true);
        self.flow_depth += 1;
        let outer = std::mem::replace(&mut self.walk_declared, parent_ty);
        let narrowed = self.flow_type(&mut walk, flow);
        self.walk_declared = outer;
        self.flow_depth -= 1;
        if walk.steps >= MAX_STEPS {
            return declared;
        }
        if narrowed == TypeId::NEVER {
            // Nothing is known of what cannot be reached.
            return if self.is_reachable_by_walk(&walk, flow) {
                TypeId::NEVER
            } else {
                declared
            };
        }
        self.type_of_binding_element(file, pat, narrowed)
    }

    /// `getNarrowedTypeOfSymbol`, of the parameter `p` at `e`. Where nothing is written of its type and the function is expected to
    /// take one rest parameter that is a union of tuples, tests of the other parameters say which of the tuples was passed.
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
        let count = params.len() + hir[func].this_ty.is_some() as usize;
        let flow = bound.expr_flow[e.idx()];
        // `isContextSensitiveFunctionOrObjectLiteralMethod`: one with type parameters of its own takes nothing from where it is.
        if count < 2
            || !matches!(
                hir[func].kind,
                FnKind::Expr | FnKind::Arrow | FnKind::Method
            )
            || !hir[func].type_params.is_empty()
            || flow == UNREACHABLE
            || self.flow_depth > 12
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
        // `getReducedApparentType`
        let rest_ty = self.apparent_type(rest.ty);
        let rest_ty = self.reduced(rest_ty);
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
        let mut walk = Walk::new(reference, rest_ty, rest_ty, Auto::No, true);
        self.flow_depth += 1;
        let outer = std::mem::replace(&mut self.walk_declared, rest_ty);
        let narrowed = self.flow_type(&mut walk, flow);
        self.walk_declared = outer;
        self.flow_depth -= 1;
        if walk.steps >= MAX_STEPS {
            return declared;
        }
        // Nothing is known of what cannot be reached.
        let narrowed = if narrowed == TypeId::NEVER && !self.is_reachable_by_walk(&walk, flow) {
            rest_ty
        } else {
            narrowed
        };
        // It is this whether or not anything was found out: a parameter written `x?` is not `undefined` for that.
        let index = self.number_literal((p.0 - params.start) as f64, false);
        self.indexed_access(narrowed, index)
    }

    fn crosses_functions(&mut self, walk: &Walk) -> bool {
        match walk.crossing {
            Crossing::No => false,
            Crossing::Yes => true,
            Crossing::PastLastAssignment(symbol, e) => {
                self.is_past_last_assignment(walk.reference.file, symbol, e)
            }
        }
    }

    /// `crosses_functions`, found out once for the walk.
    fn settle_crossing(&mut self, walk: &mut Walk) -> bool {
        let crosses = self.crosses_functions(walk);
        walk.crossing = if crosses { Crossing::Yes } else { Crossing::No };
        crosses
    }

    /// `walk` starts from `declared | undefined`.
    fn start_unassigned(&mut self, walk: &mut Walk) {
        let declared = walk.declared;
        if walk.auto == Auto::No
            && self.p.files.options.strict_null_checks
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

    /// What the reference is where `walk` ends without having met an assignment.
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

    /// Whether control gets to `flow`, where `walk` found nothing that its reference can be. It goes out of the functions the walk
    /// goes out of.
    fn is_reachable_by_walk(&mut self, walk: &Walk, flow: FlowId) -> bool {
        let crosses_functions = self.crosses_functions(walk);
        let outer = std::mem::replace(&mut self.reachability_crosses_functions, crosses_functions);
        let past = std::mem::replace(&mut self.reachability_past_exhaustive_switches, true);
        let is_this = walk.reference.root == Root::This && walk.reference.path.is_empty();
        let reachable = self.is_reachable_inner(
            walk.reference.file,
            flow,
            is_this,
            &mut Vec::new(),
            &mut Vec::new(),
        );
        self.reachability_crosses_functions = outer;
        self.reachability_past_exhaustive_switches = past;
        reachable
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
        // Every member can hold some of what all of them can hold, but for one whose property can hold nothing.
        if narrowed == prop && !has_never {
            return ty;
        }
        self.members_with_discriminant(ty, access.name, narrowed)
    }

    /// What the property that `access` is to holds in `ty`, and whether it can hold nothing in some member. `None`: nothing is made
    /// of the property.
    fn type_of_discriminant(&mut self, ty: TypeId, access: Access) -> Option<(TypeId, bool)> {
        let key = (ty, access.name, access.optional, access.non_null);
        if let Some(&known) = self.flow_memo.discriminant_types.get(&key) {
            return known;
        }
        let (found, is_memoizable) =
            self.run_memoizable(|c| c.type_of_discriminant_uncached(ty, access));
        if is_memoizable && !self.uncertain && !self.is_stack_low() {
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
        // `getTypeOfPropertyOfType`, which for a union is what `createUnionOrIntersectionProperty` makes.
        let mut prop_types: SmallVec<[TypeId; 8]> = SmallVec::new();
        let (mut is_declared, mut has_never) = (false, false);
        for &m in self.parts(base) {
            // What nothing can be has no say in what the property is. (It stays in the union all the same.)
            if self.is_never_intersection(m) {
                continue;
            }
            // Past the fixed elements of a tuple there is what the rest of it holds, and nothing where it ends.
            let apparent = self.apparent_type(m);
            if let TypeData::Tuple { elems, flags, .. } = self.data(apparent)
                && self.is_numeric_name(name)
                && self.prop_ref(apparent, name).is_none()
            {
                let fixed = flags
                    .iter()
                    .position(|f| f.intersects(ElemFlags::REST | ElemFlags::VARIADIC))
                    .unwrap_or(flags.len());
                prop_types.push(if fixed < flags.len() {
                    self.tuple_element_union(&elems[fixed..], &flags[fixed..])
                } else {
                    TypeId::UNDEFINED
                });
                continue;
            }
            match self.type_of_property(m, name) {
                Some(t) => {
                    is_declared = is_declared || self.finds_property(m, name);
                    has_never |= t == TypeId::NEVER;
                    prop_types.push(t);
                }
                // An object literal that does not mention it does not have it; of anything else nothing is known.
                None if self.is_closed_object_literal_type(m) => prop_types.push(TypeId::UNDEFINED),
                None => return None,
            }
        }
        // An index signature stands in for it only next to a member that has it.
        if !is_declared {
            return None;
        }
        let mut prop = self.union(&prop_types);
        if self.is_any(prop) {
            return None;
        }
        if remove_nullable && access.optional {
            prop = self.optional(prop);
        }
        Some((prop, has_never))
    }

    /// The members of `ty` whose property `name` can hold some of `narrowed`.
    fn members_with_discriminant(&mut self, ty: TypeId, name: Atom, narrowed: TypeId) -> TypeId {
        let key = (ty, name, narrowed);
        if let Some(&known) = self.flow_memo.discriminated_types.get(&key) {
            return known;
        }
        let (left, is_memoizable) = self.run_memoizable(|c| {
            c.filter(ty, |c, m| {
                let discriminant = c
                    .type_of_property_or_index_signature(m, name)
                    .unwrap_or(TypeId::UNKNOWN);
                discriminant != TypeId::NEVER
                    && narrowed != TypeId::NEVER
                    && c.are_comparable(narrowed, discriminant)
            })
        });
        if is_memoizable && !self.uncertain && !self.is_stack_low() {
            self.flow_memo.discriminated_types.insert(key, left);
        }
        left
    }

    /// `getTypeOfPropertyOrIndexSignatureOfType`: what only an index signature gives may be missing.
    fn type_of_property_or_index_signature(&mut self, ty: TypeId, name: Atom) -> Option<TypeId> {
        if self.is_nullish(ty) {
            return None;
        }
        let found = self.type_of_property(ty, name)?;
        Some(if self.finds_property(ty, name) {
            found
        } else {
            self.optional_property(found)
        })
    }

    // ───────────────────────────── tests ─────────────────────────────

    /// Whether `narrow` may make something of the test `expr`, that of the flow node `flow`, for `reference`. If not, it would ask
    /// nothing and hand back the type it is given.
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
        // Nearly all walks are in the file whose errors are being looked for.
        if self.checking == Some(file) && memo.tests_of != Some(file) {
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

    /// Adds to `about` all that `narrow` compares a reference with when it is given the test `e`. `level`: how many constants that
    /// hold a test have been looked through.
    fn note_test(&self, file: FileId, e: ExprId, level: u32, about: &mut About) {
        if about.state & About::ANYTHING != 0 {
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
                // What it is called on. `x.hasOwnProperty("a")` says something of `x.a`. For any other method `x.method` will do,
                // which is about less than `x`.
                if let ExprKind::Dot { obj, name, .. } = hir[call.callee].kind {
                    if self.files().atoms.bytes(name) == b"hasOwnProperty" {
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
                // `"a" in x` says something of `x.a`.
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

    /// Adds to `about` what `e`, which a reference is compared with, starts with: all that `matches_prefix` and
    /// `optional_chain_contains` go through on their way in. `is_whole`: `e` is asked whether it is a `discriminant_access`,
    /// which a constant can stand for: `const k = x.kind`, `const { kind: k } = x`. `first`: what to put down for how it goes on
    /// if it does not.
    fn note_chain(
        &self,
        file: FileId,
        e: ExprId,
        mut is_whole: bool,
        mut first: u32,
        about: &mut About,
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
                    // `access_key` asks what such a key holds.
                    if matches!(hir[index].kind, ExprKind::Ident(_) | ExprKind::Dot { .. }) {
                        about.state |= About::ANYTHING;
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
        let file = reference.file;
        let hir = self.hir(file);
        // The `a` of `a?.b`, `a ?? b` and `a ??= b` is tested for being there, not for being true.
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
                // `x?.f()` came to something: `x` was there. (Not seen through `const ok = x?.f()`.) `narrowTypeByCallExpression` has no
                // such test, so no key is named for it.
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

    /// `getReferenceCandidate`: what `x = v`, `x ||= v` and the like leave behind is `x`, and `a, x` is `x`. `x!` is not looked into.
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
                // `x?.a === v` says `x` is there if `v` is not `undefined`; `x?.a !== undefined` says so too.
                let is_equal = matches!(op, BinOp::EqEq | BinOp::EqEqEq) == sense;
                let value_ty = self.type_of_expr(file, value);
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
            && let Some(constituents) = self.constituents_by_key_property(ty, access.name)
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

    /// `getKeyPropertyName` and the map that goes with it (`computeKeyPropertyNameAndMap`): the member of the union `ty` that each
    /// value of the property `name` stands for, UNKNOWN for a value several members have. `None` unless `ty` has ten object types
    /// or more and `name` is the property they are told apart by.
    fn constituents_by_key_property(
        &mut self,
        ty: TypeId,
        name: Atom,
    ) -> Option<std::rc::Rc<FxHashMap<TypeId, TypeId>>> {
        if !self.is_union(ty) || self.parts(ty).len() < 10 {
            return None;
        }
        if let Some(known) = self.flow_memo.key_properties.get(&(ty, name)) {
            return known.clone();
        }
        let (constituents, is_memoizable) =
            self.run_memoizable(|c| c.constituents_by_key_property_uncached(ty, name));
        let constituents = constituents.map(std::rc::Rc::new);
        if is_memoizable {
            self.flow_memo
                .key_properties
                .insert((ty, name), constituents.clone());
        }
        constituents
    }

    fn constituents_by_key_property_uncached(
        &mut self,
        ty: TypeId,
        name: Atom,
    ) -> Option<FxHashMap<TypeId, TypeId>> {
        let parts = self.parts(ty);
        // `TypeFlagsObject | TypeFlagsInstantiableNonPrimitive`
        let counts = |c: &Self, m: TypeId| {
            c.is_object_type(m) || c.is_deferred(m) && !matches!(c.data(m), TypeData::Keyof(_))
        };
        if parts.len() < 10 || parts.iter().filter(|&&m| counts(self, m)).count() < 10 {
            return None;
        }
        // `getKeyPropertyCandidateName`: the first property met that holds one value.
        let mut candidate = None;
        'members: for &m in parts {
            if !counts(self, m) {
                continue;
            }
            let apparent = self.apparent_type(m);
            let Some(members) = self.members(apparent) else {
                continue;
            };
            for prop in &members.shape().props {
                let held = self.type_of_prop(prop, members.mapper);
                if self.is_unit(held) {
                    candidate = Some(prop.name);
                    break 'members;
                }
            }
        }
        if candidate != Some(name) {
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
        (count >= 10 && count * 2 >= parts.len()).then_some(constituents)
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
        // That it is not the constructor says nothing.
        if ty == TypeId::UNRESOLVED || sense != matches!(op, BinOp::EqEq | BinOp::EqEqEq) {
            return ty;
        }
        let constructor = self.type_of_expr(file, identifier);
        if !self.is_known(constructor) {
            self.uncertain = true;
            return ty;
        }
        // `isFunctionType`, `isConstructorType`
        let is_function =
            self.is_object_type(constructor) && !self.signatures(constructor, false).is_empty();
        if !is_function && self.signatures(constructor, true).is_empty() {
            return ty;
        }
        let Some(candidate) = self.type_of_property(constructor, known::prototype) else {
            return ty;
        };
        self.uncertain |= !self.is_known(candidate);
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

    /// `isConstructedBy`: classes are told apart by which they are, not by what is in them.
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

    /// `ObjectFlagsClass`: what a class declares. Not that with other type arguments: `C<any>` is a reference to it.
    fn is_declared_class_type(&mut self, ty: TypeId) -> bool {
        let TypeData::Ref { target, .. } = *self.data(ty) else {
            return false;
        };
        self.files().flags(target).contains(SymFlags::CLASS) && self.declared_type(target) == ty
    }

    /// The type of `value`, which something is compared with.
    fn type_of_compared(&mut self, file: FileId, value: ExprId) -> TypeId {
        // A constant that can only be one thing is that thing: following it around leads back here, over and over in a loop.
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
            None => self.type_of_expr(file, value),
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
            self.uncertain = true;
            return ty;
        }
        let key = (ty, as_written, loose, sense);
        if let Some(&known) = self.flow_memo.equal_types.get(&key) {
            return known;
        }
        let (narrowed, is_memoizable) =
            self.run_memoizable(|c| c.narrow_by_equal_type(ty, as_written, value_ty, loose, sense));
        if is_memoizable && !self.uncertain && !self.is_stack_low() {
            self.flow_memo.equal_types.insert(key, narrowed);
        }
        narrowed
    }

    /// `ty`, of which it is known whether it is equal (`sense`) to something of the type `as_written`, `value_ty` as an annotation
    /// would name it. `loose`: equal the way `==` has it.
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
            // Of `unknown` and of `{}`, all that is known is what it was found to be the same as.
            if !loose
                && (ty == TypeId::UNKNOWN
                    || self
                        .parts(ty)
                        .iter()
                        .any(|&m| self.is_empty_anonymous_object_type(m)))
            {
                if self.has_primitive_flags(value_ty)
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
            let coerces =
                loose && matches!(value_ty, TypeId::NUMBER | TypeId::STRING | TypeId::BOOLEAN);
            let kept = self.filter(ty, |c, m| {
                c.are_comparable(m, value_ty)
                    || coerces
                        && (m == TypeId::NUMBER || m == TypeId::STRING || c.is_boolean_like(m))
            });
            // As fresh as it is written: a `string` known to be `"a"` is a `string` again where it is stored.
            return self.replace_primitives_with_literals(kept, as_written);
        }
        if self.is_unit(value_ty) {
            return self.filter(ty, |c, m| {
                !(c.is_unit_like(m) && c.are_comparable(m, value_ty))
            });
        }
        ty
    }

    /// `TypeFlagsPrimitive`, which `boolean` and the type of an enum have though they are unions. `string | number` has it not.
    fn has_primitive_flags(&mut self, ty: TypeId) -> bool {
        if self.is_primitive(ty) || ty == TypeId::BOOLEAN {
            return true;
        }
        let TypeData::Union(parts) = self.data(ty) else {
            return false;
        };
        let (TypeData::EnumLit { member, .. } | TypeData::Enum { symbol: member, .. }) =
            *self.data(parts[0])
        else {
            return false;
        };
        self.enum_type_of_member(member) == ty
    }

    /// `isUnitLikeType`: a literal with a tag on it is one too.
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

    /// `replacePrimitivesWithLiterals`: `string` that was found equal to `"a"` is `"a"`.
    fn replace_primitives_with_literals(&mut self, ty: TypeId, literals: TypeId) -> TypeId {
        fn is_pattern(c: &Checker<'_>, t: TypeId) -> bool {
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

    /// `getEffectsSignature`, of `e`, which is `left instanceof right`. `right_type`: the type of `right`.
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
                self.resolve_call(file, e).sig
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
        let constructor = self.type_of_expr(file, right);
        self.uncertain |= !self.is_known(constructor);
        let object = self.global_ref(known::Object, &[]);
        if !self.is_type_derived_from(constructor, object) {
            return ty;
        }
        // A `[Symbol.hasInstance]` that is a type guard has the say.
        if let Some(sig) = self.effects_signature_of_instanceof(file, e, constructor)
            && let Some(Predicate {
                param: Some(0),
                ty: Some(guarded),
                asserts: false,
            }) = self.sig_predicate(sig)
        {
            return self.narrowed_to(ty, guarded, sense, true);
        }
        let function = self.global_ref(known::Function, &[]);
        if !self.is_type_derived_from(constructor, function) {
            return ty;
        }
        let instance = self.map_type(constructor, |c, m| c.instance_type(m));
        // `any` is not narrowed to `Object` or `Function`. And that it is not an instance says something only of a type that
        // has something to it.
        if self.is_any(ty) && (instance == object || instance == function)
            || !sense
                && !(self.is_object_type(instance)
                    && !self.is_empty_anonymous_object_type(instance))
        {
            return ty;
        }
        self.narrowed_to(ty, instance, sense, true)
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
        // Nothing is known of what it makes.
        if returns.is_empty() {
            TypeId::EMPTY_OBJECT
        } else {
            self.union(&returns)
        }
    }

    /// `isTypeDerivedFrom`: going by what is said to extend what, not by what is in it.
    pub(super) fn is_type_derived_from(&mut self, source: TypeId, target: TypeId) -> bool {
        let (source, target) = (self.force(source), self.force(target));
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
        if self.is_global_ref(target, known::Object).is_some() {
            return is_object && !self.is_empty_anonymous_object_type(source);
        }
        if self.is_global_ref(target, known::Function).is_some() {
            return self.is_object_type(source) && self.is_function_object_type(source);
        }
        let TypeData::Ref { target: base, .. } = *self.data(target) else {
            return false;
        };
        if self.has_base(source, base, 0) {
            return true;
        }
        if self.is_global_ref(target, known::Array).is_some() {
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
        check_derived: bool,
    ) -> TypeId {
        if !self.is_union(ty) {
            return self.narrowed_to_uncached(ty, candidate, sense, check_derived);
        }
        let key = (ty, candidate, sense, check_derived);
        if let Some(&known) = self.flow_memo.narrowed_types.get(&key) {
            return known;
        }
        let (narrowed, is_memoizable) =
            self.run_memoizable(|c| c.narrowed_to_uncached(ty, candidate, sense, check_derived));
        if is_memoizable {
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
        check_derived: bool,
    ) -> TypeId {
        if ty == TypeId::UNRESOLVED {
            return ty;
        }
        if !sense {
            if ty == candidate {
                return TypeId::NEVER;
            }
            if check_derived {
                return self.filter(ty, |c, m| !c.is_type_derived_from(m, candidate));
            }
            // `unknownUnionType`: `unknown` is `{} | null | undefined` for the time being.
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
            let if_so = self.narrowed_to(ty, candidate, true, false);
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
            // Of two that have to do with each other, the more specific. If it goes both ways: what is asserted for a type guard;
            // what was there for `instanceof`, since a prototype knows nothing of type arguments.
            let directly_related = c.map_type(ty, |c, t| {
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
            if directly_related != TypeId::NEVER {
                return directly_related;
            }
            // Failing that, what waits for type parameters and may turn out to be one.
            c.map_type(ty, |c, t| {
                let may_be_generic = match c.data(t) {
                    TypeData::Intersection(parts) => parts.iter().any(|&p| c.is_deferred(p)),
                    _ => c.is_deferred(t),
                };
                if may_be_generic {
                    let constraint = c.base_constraint(t);
                    let related = constraint == TypeId::UNKNOWN
                        || if check_derived {
                            c.is_type_derived_from(n, constraint)
                        } else {
                            c.is_subtype(n, constraint)
                        };
                    if related {
                        return c.intersection(&[t, n]);
                    }
                }
                TypeId::NEVER
            })
        });
        if narrowed != TypeId::NEVER {
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
        // `narrowTypeByPrivateIdentifierInInExpression`: `#x in v` says whether `v` is of the class that declares `#x`.
        if let ExprKind::String(name) = hir[left].kind
            && is_private_name_at(hir, hir[left].pos)
        {
            let Some(&class) = self.bound(file).private_class.get(&left) else {
                return ty;
            };
            if !self.matches(reference, right) {
                return ty;
            }
            // `lookupSymbolForPrivateIdentifierDeclaration`: the members of the class before its statics.
            let is_static = !hir[class].members.iter().any(|m| {
                hir[m].key == PropKey::Private(name) && !hir[m].flags.contains(Flags::STATIC)
            });
            let sym = self.class_sym(file, class);
            let target = if is_static {
                self.type_of_symbol(sym)
            } else {
                self.declared_type(sym)
            };
            if !self.is_known(target) {
                self.uncertain = true;
                return ty;
            }
            return self.narrowed_to(ty, target, sense, true);
        }
        // `"a" in x` says of `x.a` whether it is there, where its type says that it may not be (`containsMissingType`).
        if let Some((&last, _)) = reference.path.split_last()
            && self.contains_missing_type(ty)
            && self.matches_prefix(reference, reference.path.len() - 1, right)
        {
            let key = self.type_of_expr(file, left);
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
        let key = self.type_of_expr(file, left);
        let Some(name) = self.property_name_of_type(key) else {
            return ty;
        };
        if self.is_any(ty) {
            // Nothing is declared in it: the intersection with `Record<K, unknown>` below, which is `errorType` of an error type.
            let is_intersected = sense && self.global_type_symbol(known::Record).is_some();
            return if is_intersected && self.is_error_type(ty) {
                TypeId::ERROR
            } else {
                ty
            };
        }
        // `isTypePresencePossible`. What every object and every function has is a property like any other.
        let may_be = |c: &mut Self, m: TypeId, present: bool| {
            let apparent = c.apparent_type(m);
            if c.is_union(apparent) {
                return c.is_type_presence_possible_in_union(apparent, name, present);
            }
            let Some(members) = c.members(apparent) else {
                return !present;
            };
            match c.property_in(&members, name) {
                Some((prop, _)) => present || prop.flags.contains(PropFlags::OPTIONAL),
                None => c.applicable_index_type_for_name(&members, name).is_some() || !present,
            }
        };
        if self.parts(ty).iter().any(|&m| may_be(self, m, true)) {
            return self.filter(ty, |c, m| may_be(c, m, sense));
        }
        // Nothing declares it: if it is there all the same, that is all that is known of it.
        if sense && let Some(record) = self.global_type_symbol(known::Record) {
            let key = self.regular(key);
            let record = self.type_reference(record, &[key, TypeId::UNKNOWN]);
            return self.intersection(&[ty, record]);
        }
        ty
    }

    /// `isTypePresencePossible`, of a type variable whose apparent type is the union `apparent`: `getPropertyOfType` gives what
    /// `createUnionOrIntersectionProperty` makes, and `getApplicableIndexInfoForName` goes by `getUnionIndexInfos`.
    fn is_type_presence_possible_in_union(
        &mut self,
        apparent: TypeId,
        name: Atom,
        assume_true: bool,
    ) -> bool {
        let is_late_bound = self.files().atoms.is_symbol_name(name);
        let parts = self.parts(apparent);
        let (mut is_declared, mut is_optional) = (false, false);
        // `CheckFlagsWritePartial`, `CheckFlagsReadPartial`
        let (mut is_write_partial, mut is_read_partial) = (false, false);
        for &part in parts {
            let part = self.apparent_type(part);
            if part == TypeId::NEVER {
                continue;
            }
            let Some(members) = self.members(part) else {
                is_read_partial = true;
                continue;
            };
            if let Some((prop, _)) = self.property_in(&members, name) {
                is_declared = true;
                is_optional |= prop.flags.contains(PropFlags::OPTIONAL);
            } else if !is_late_bound
                && self
                    .applicable_index_type_for_name(&members, name)
                    .is_some()
                || self.is_closed_object_literal_type(part)
            {
                is_write_partial = true;
            } else {
                is_read_partial = true;
            }
        }
        if is_declared && !is_read_partial && !self.is_hidden_in_union(parts, name) {
            return is_optional || is_write_partial || assume_true;
        }
        let key = if is_late_bound {
            TypeId::SYMBOL
        } else {
            self.string_literal(name, false)
        };
        let infos = self.index_signatures_of(apparent);
        infos
            .iter()
            .any(|&(index_key, _)| self.is_applicable_index_type(key, index_key))
            || !assume_true
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
        // `x.hasOwnProperty("a")` says of `x.a` what `"a" in x` says.
        let file = reference.file;
        let hir = self.hir(file);
        if let Some((&last, _)) = reference.path.split_last()
            && self.contains_missing_type(ty)
            && let ExprKind::Call(c) = hir[call].kind
            && let ExprKind::Dot { obj, name, .. } = hir[hir[c].callee].kind
            && hir[c].args.len() == 1
            && let ExprKind::String(text) = hir[hir.id_at(hir[c].args, 0)].kind
            && text == last
            && self.files().atoms.bytes(name) == b"hasOwnProperty"
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

    /// What `call` says of the reference if what is called is a type guard that is about it. `None`: it is not.
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
        // That `x?.isFoo(y)` is not true may be for want of an `x`.
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
        // Going by what the function is declared as: the call is only resolved if that is what it takes to know which
        // type guard is meant. It may well be the call whose arguments are being looked at.
        let callee = match hir[data.callee].kind {
            // A method of what is being narrowed: what that is here is at hand, and asking would come back here.
            ExprKind::Dot { obj, name, .. } if self.matches(reference, obj) => {
                let receiver = self.non_nullable(ty);
                self.type_of_property(receiver, name)?
            }
            _ => self.type_of_expr(file, data.callee),
        };
        let callee = self.non_nullable(callee);
        self.uncertain |= !self.is_known(callee);
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
                self.resolve_call(file, call).sig?
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
                    && (self.is_global_ref(target, known::Object).is_some()
                        || self.is_global_ref(target, known::Function).is_some())
                {
                    return ty;
                }
                if self.matches(reference, subject) {
                    return self.narrowed_to(ty, target, sense, false);
                }
                // A chain that stops short gives `undefined`. This one did not, if what it gave is something `undefined` is not, or
                // is not something that is all `undefined` and `null`.
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
                        c.narrowed_to(t, target, sense, false)
                    });
                }
                ty
            }
            // `getTypeAtFlowCall`: `asserts x`. `asserts this` says nothing.
            None if predicate.param.is_some() => self.narrow_by_asserted(reference, ty, subject),
            None => ty,
        }
    }

    /// `narrowTypeByAssertion`: `e` is asserted. Control does not get past `assert(false)`.
    fn narrow_by_asserted(&mut self, reference: &Reference, ty: TypeId, e: ExprId) -> TypeId {
        match self.hir(reference.file)[e].kind {
            ExprKind::False => TypeId::NEVER,
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

    /// `isFalseExpression`
    fn is_false_expression(&self, file: FileId, e: ExprId) -> bool {
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
        let ty = self.force(ty);
        ty != TypeId::NEVER
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
            // `typeof x?.a` is `"undefined"` if the chain stops short. In parentheses it is no chain.
            if strict
                && !is_parenthesized(hir, operand)
                && self.optional_chain_contains(reference, operand)
            {
                return self.narrow_by_switch_optional_chain_containment(file, ty, cases, from, to, |c, t| {
                    let is_undefined = matches!(
                        *c.data(t),
                        TypeData::StringLit { value, .. } | TypeData::EnumLit { value: EnumValue::String(value), .. } if value == known::undefined
                    );
                    t != TypeId::NEVER && !is_undefined
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
                |_, t| !t.is_undefined() && t != TypeId::NEVER,
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
        // None of the tests before came out true.
        let mut result = ty;
        for i in 0..from {
            let test = hir[cases.at(i)].test;
            if test.is_some() {
                result = self.narrow(reference, result, test, false);
            }
        }
        // Where `default` is among them, none of those after did either. Those next to it say nothing: there are other ways here.
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

    /// `narrowTypeBySwitchOptionalChainContainment`: the chain that the `switch` looks at got to its end if the type of every one of the
    /// clauses `from..to` passes `check`. That of `default` is `never`.
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
                let t = self.type_of_expr(file, test);
                self.uncertain |= !self.is_known(t);
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
            && let Some(constituents) = self.constituents_by_key_property(ty, access.name)
        {
            let hir = self.hir(file);
            let mut candidates = Vec::with_capacity(to - from);
            for i in from..to {
                let test = hir[cases.at(i)].test;
                // `default` stands for no member, nor does a value that several members have: the ordinary way.
                if test.is_none() {
                    break;
                }
                let key = self.type_of_expr(file, test);
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
                let t = self.type_of_expr(file, test);
                Some(self.regular(t))
            });
        }
        let has_default = from == to || all[from..to].contains(&None);
        let clause_types: SmallVec<[TypeId; 8]> = all[from..to].iter().flatten().copied().collect();
        if ty == TypeId::UNKNOWN && !has_default {
            // An object among the cases says that it is an object, not which.
            let mut ground = Vec::with_capacity(clause_types.len());
            for &t in &clause_types {
                if self.has_primitive_flags(t) || t == TypeId::OBJECT {
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
        let case_type = if discriminant == TypeId::NEVER {
            TypeId::NEVER
        } else {
            let kept = self.filter(ty, |c, m| c.are_comparable(discriminant, m));
            self.replace_primitives_with_literals(kept, discriminant)
        };
        if !has_default {
            return case_type;
        }
        // What is one value goes if a case may be that value: `"a"` for `case E.a`, if that is what `E.a` is.
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
        if case_type == TypeId::NEVER {
            return default_type;
        }
        self.union(&[case_type, default_type])
    }

    /// `getSwitchClauseTypeOfWitnesses`: the name each clause tests for. None for `default`, for `""` and for a name an earlier clause
    /// has. `None`: some clause tests for something that is not written as a string, or as one in parentheses.
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
            // What is not taken by any other clause.
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

    /// `isGenericTypeWithUnionConstraint`: what waits for type parameters, be it a template, and extends a union, `undefined` or `null`.
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

    /// Whether `e` is where what its type extends is what counts: `e.x`, `e[x]`, `e()`, `new e()`.
    fn is_constraint_position(&mut self, file: FileId, e: ExprId, ty: TypeId) -> bool {
        let hir = self.hir(file);
        let Parent::Expr(parent) = self.bound(file).expr_parent[e.idx()] else {
            return false;
        };
        match hir[parent].kind {
            ExprKind::Dot { obj, .. } => obj == e,
            ExprKind::Call(c) | ExprKind::New(c) => hir[c].callee == e,
            // `t[k]` of a `T` and a `K` is to be `T[K]`.
            ExprKind::Index { obj, index, .. } if obj == e => {
                if !self
                    .parts(ty)
                    .iter()
                    .any(|&m| self.is_generic_without_nullable_constraint(m))
                {
                    return true;
                }
                let index = self.type_of_expr(file, index);
                !self.is_generic(index)
            }
            _ => false,
        }
    }

    /// `getNarrowableTypeForReference`: `declared` with what its type variables extend in their place, where that is what will count
    /// anyway and is a union: as a type variable it could not be narrowed.
    fn narrowable_type(&mut self, file: FileId, e: ExprId, declared: TypeId) -> TypeId {
        let declared = match *self.data(declared) {
            TypeData::Substitution {
                base,
                constraint: TypeId::UNKNOWN,
            } => base,
            _ => declared,
        };
        // `CheckModeInferential`: what type arguments are inferred from stays as it is declared. It is said of this one question, not
        // of what is assigned to the reference on the way here.
        if self.inferential == Some((file, e)) {
            self.inferential = None;
            return declared;
        }
        if !self.has_type_variables(declared)
            || !self
                .parts(declared)
                .iter()
                .any(|&m| self.is_generic_with_union_constraint(m))
        {
            return declared;
        }
        if !self.is_constraint_position(file, e, declared) {
            match self.contextual_type(file, e) {
                // `CheckModeInferential` goes down into a literal, and the literal is then held against what was inferred from it, which
                // has the type variables. Unless that does not fit what the type parameter extends: then it is held against that.
                Some(expected) if !self.is_generic(expected) => {
                    if self.is_in_literal_inferred_from(file, e)
                        && self.is_assignable(declared, expected)
                        || self.is_candidate_despite_return_mapper(file, e, declared)
                    {
                        return declared;
                    }
                }
                _ => return declared,
            }
        }
        self.map_type(declared, |c, m| {
            let constraint = c.base_constraint(m);
            if constraint == TypeId::UNKNOWN {
                m
            } else {
                constraint
            }
        })
    }

    /// Whether `e` stands in an array or object literal that is expected to be a type parameter of the function it is passed to: what
    /// is expected of `e` was read off what that type parameter extends. Such a type parameter is not in scope where `e` is.
    fn is_in_literal_inferred_from(&mut self, file: FileId, e: ExprId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let scope = self.scope_of_expr(file, e);
        let in_scope = self.type_params_in_scope(file, scope);
        let mut at = e;
        loop {
            let parent = match bound.expr_parent[at.idx()] {
                Parent::Prop(p) if hir[p].value == at => bound.prop_owner[p.idx()],
                Parent::Expr(parent) => parent,
                _ => return false,
            };
            match hir[parent].kind {
                ExprKind::Array(_) | ExprKind::Object(_) => {
                    let Some(expected) = self.contextual_type(file, parent) else {
                        return false;
                    };
                    if self.parts(expected).iter().any(|m| {
                        matches!(self.data(*m), TypeData::TypeParam(..)) && !in_scope.contains(m)
                    }) {
                        return true;
                    }
                }
                ExprKind::Cond { test, .. } if test != at => {}
                ExprKind::Binary {
                    op: BinOp::Or | BinOp::Nullish,
                    ..
                } => {}
                ExprKind::Binary {
                    op: BinOp::And | BinOp::Comma,
                    right,
                    ..
                } if right == at => {}
                _ => return false,
            }
            at = parent;
        }
    }

    /// Whether the type of `e` is a candidate for a type parameter of the call that `e` is in a literal argument of, though
    /// `returnMapper` has replaced that type parameter in the contextual type recorded for the argument.
    /// `getNarrowableTypeForReference` asks for no contextual type under `CheckModeInferential`, and `isSignatureApplicable` then
    /// checks the argument against the parameter type with what was inferred from it, which outranks `returnMapper`.
    fn is_candidate_despite_return_mapper(
        &mut self,
        file: FileId,
        e: ExprId,
        declared: TypeId,
    ) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let (mut arg, mut is_in_literal) = (e, false);
        let (call, args) = loop {
            let parent = match bound.expr_parent[arg.idx()] {
                Parent::Prop(p) if hir[p].value == arg => bound.prop_owner[p.idx()],
                Parent::Expr(parent) => parent,
                _ => return false,
            };
            if parent.is_none() {
                return false;
            }
            match hir[parent].kind {
                ExprKind::Array(_) | ExprKind::Object(_) => is_in_literal = true,
                ExprKind::Cond { test, .. } if test != arg => {}
                ExprKind::Binary {
                    op: BinOp::Or | BinOp::Nullish,
                    ..
                } => {}
                ExprKind::Binary {
                    op: BinOp::And | BinOp::Comma,
                    right,
                    ..
                } if right == arg => {}
                ExprKind::Call(c) | ExprKind::New(c) if is_in_literal && hir[c].callee != arg => {
                    break (parent, hir[c].args);
                }
                _ => return false,
            }
            arg = parent;
        };
        if hir
            .ids(args)
            .any(|a| matches!(hir[a].kind, ExprKind::Spread(_)))
        {
            return false;
        }
        let Some(index) = hir.ids(args).position(|a| a == arg) else {
            return false;
        };
        let resolving = self
            .resolving
            .iter()
            .rev()
            .find(|r| r.file == file && r.call == call)
            .map(|r| (r.sig, r.params.clone(), r.return_mapper));
        // The type parameters that are inferred. The signature of a resolved call has what was inferred in their place.
        let (params, type_params) = match resolving {
            Some((Some(sig), params, return_mapper)) if return_mapper != MapperId::IDENTITY => {
                (params, Some(self.sig_type_params(sig)))
            }
            Some(_) => return false,
            None => {
                let Some(resolved) = self.p.calls.get(&(file, call)) else {
                    return false;
                };
                let Some(sig) = resolved.sig else {
                    return false;
                };
                (self.sig_params(sig), None)
            }
        };
        let Some(param) = self.context_of_arg_at(&params, index, Some(args.len())) else {
            return false;
        };
        self.contextual.push((file, arg, param));
        let expected = self.contextual_type(file, e);
        let is_candidate = match (expected, &type_params) {
            (Some(expected), None) => self.is_generic(expected),
            (None, None) => true,
            (Some(expected), Some(type_params)) if self.is_generic(expected) => {
                // `getInferredType`: a candidate that does not fit the constraint gives way to the constraint.
                self.parts(expected)
                    .iter()
                    .any(|member| type_params.contains(member))
                    && {
                        let constraint = self.base_constraint(expected);
                        self.is_assignable(declared, constraint)
                    }
            }
            (Some(expected), Some(_)) => {
                self.is_in_literal_inferred_from(file, e) && self.is_assignable(declared, expected)
            }
            (None, Some(_)) => self.is_in_literal_inferred_from(file, e),
        };
        self.contextual.pop();
        is_candidate
    }

    pub(super) fn narrow_reference(&mut self, file: FileId, e: ExprId, declared: TypeId) -> TypeId {
        // Of `string` it can be found out that it is `"a"`, and of `"a"` that it is not even that.
        if declared == TypeId::UNRESOLVED || declared == TypeId::NEVER {
            return declared;
        }
        let declared = self.narrowable_type(file, e, declared);
        // `checkIdentifier`: a variable that is not known to hold anything where its flow starts may be `undefined` there.
        let ty = self.flow_type_of(file, e, declared, true);
        // 2454 is said of this. The declared type keeps further errors down.
        if ty != declared
            && self.contains_undefined(ty)
            && !self.contains_undefined(declared)
            && !self.assumes_initialized(file, e, declared)
        {
            return declared;
        }
        ty
    }

    /// `getFlowTypeOfReference` of a `this` expression (`tryGetThisTypeAtEx`).
    pub(super) fn narrow_this(&mut self, file: FileId, e: ExprId, declared: TypeId) -> TypeId {
        if declared == TypeId::UNRESOLVED || declared == TypeId::NEVER {
            return declared;
        }
        self.flow_type_of(file, e, declared, false)
    }

    /// The type of the property or element access `e`, which is no assignment target and whose property is declared as `declared`.
    pub(super) fn narrow_access(&mut self, file: FileId, e: ExprId, declared: TypeId) -> TypeId {
        if declared == TypeId::UNRESOLVED || declared == TypeId::NEVER {
            return declared;
        }
        let declared = self.narrowable_type(file, e, declared);
        self.flow_type_of(file, e, declared, false)
    }

    /// The type of `e`, the initializer of a variable that is declared by a pattern and without a type, for the `...rest` of the
    /// pattern (`CheckModeRestBindingElement`). `None`: what the other elements see.
    pub(super) fn type_of_reference_for_rest(&mut self, file: FileId, e: ExprId) -> Option<TypeId> {
        let Parent::VarInit(d) = self.bound(file).expr_parent[e.idx()] else {
            return None;
        };
        if self.hir(file)[d].ty.is_some() {
            return None;
        }
        // Only where a type parameter can be mentioned is there one to keep.
        let scope = self.scope_of_expr(file, e);
        if !self
            .type_params_in_scope(file, scope)
            .iter()
            .any(|&p| matches!(self.data(p), TypeData::TypeParam(..)))
        {
            return None;
        }
        self.type_of_initializer_part_for_rest(file, e)
    }

    /// `e` is such an initializer, or one of the alternatives it is. `hasContextualTypeWithNoGenericTypes`: in this mode what a pattern
    /// implies is not expected of its initializer, so nothing is expected of `e`. Nor is it in a constraint position. Hence
    /// `getNarrowableTypeForReference` leaves a reference its type variables, as it does where type arguments are inferred from it.
    fn type_of_initializer_part_for_rest(&mut self, file: FileId, e: ExprId) -> Option<TypeId> {
        match self.hir(file)[e].kind {
            ExprKind::Ident(_) | ExprKind::Dot { .. } | ExprKind::Index { .. } => {
                // In the ordinary way first: that is what is kept of `e` and of all it is made of.
                let ordinary = self.type_of_expr(file, e);
                if !self.is_known(ordinary) || self.is_any(ordinary) {
                    return None;
                }
                let around = self.inferential.replace((file, e));
                let ty = self.type_of_expr_uncached(file, e);
                self.inferential = around;
                let ty = self.force(ty);
                (ty != ordinary && self.is_known(ty)).then_some(ty)
            }
            // `checkConditionalExpression` hands the mode on.
            ExprKind::Cond { yes, no, .. } => {
                let (for_yes, for_no) = (
                    self.type_of_initializer_part_for_rest(file, yes),
                    self.type_of_initializer_part_for_rest(file, no),
                );
                if for_yes.is_none() && for_no.is_none() {
                    return None;
                }
                let yes = match for_yes {
                    Some(ty) => ty,
                    None => self.type_of_expr(file, yes),
                };
                let no = match for_no {
                    Some(ty) => ty,
                    None => self.type_of_expr(file, no),
                };
                Some(self.union_reduced(&[yes, no]))
            }
            _ => None,
        }
    }

    /// Whether `e` is the `x` of `x!`. Not of `(x)!`: what is written right around it is what counts.
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
        if let Some(cached) = self.p.initializer_is_undefined.get(&(file, p)) {
            return cached;
        }
        if !self.enter(Query::InitializerIsUndefined(file, p)) {
            if self.came_full_circle {
                self.p.circular_pats.insert((file, pat), ());
            }
            return true;
        }
        let default = self.type_of_expr(file, self.hir(file)[p].default);
        // `any` has not got the fact. What is not known might.
        let contains =
            default == TypeId::UNRESOLVED || self.has_type_facts(default, facts::IS_UNDEFINED);
        let is_cacheable = self.leave();
        if self.left_a_circle {
            self.p.circular_pats.insert((file, pat), ());
            return true;
        }
        if is_cacheable {
            self.p.initializer_is_undefined.insert((file, p), contains);
        }
        contains
    }

    /// `FindAncestor(e, IsFunctionOrModuleBlock)`: `Parent::FnBody`, `Parent::Module` or `Parent::File`, and `Parent::None` for an
    /// expression the binder has not reached.
    pub(super) fn function_or_module_block_of(&self, file: FileId, e: ExprId) -> Parent {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut block = bound.expr_parent[e.idx()];
        loop {
            block = match block {
                // A static block is not function-like, and an expression body is not a block.
                Parent::FnBody(f)
                    if hir[f].kind != FnKind::StaticBlock
                        && matches!(hir[f].body, FnBody::Block(_)) =>
                {
                    return block;
                }
                Parent::Module(_) | Parent::File | Parent::None => return block,
                Parent::Expr(x) if x.is_none() => Parent::None,
                Parent::Key(object) if object.is_some() => Parent::Expr(object),
                _ => self.outward(file, block),
            };
        }
    }

    /// `is_variable`: `e` reads a variable, which starts out the way `assumes_initialized` has it.
    fn flow_type_of(
        &mut self,
        file: FileId,
        e: ExprId,
        declared: TypeId,
        is_variable: bool,
    ) -> TypeId {
        // It is said of this reference alone, not of what has to be asked about on the way.
        let starts_unassigned = std::mem::take(&mut self.starts_unassigned);
        let bound = self.bound(file);
        let flow = bound.expr_flow[e.idx()];
        if flow == UNREACHABLE {
            return declared;
        }
        let Some(reference) = self.reference_of(file, e) else {
            return declared;
        };
        if self.flow_depth > 12 {
            return declared;
        }
        let auto = match reference.root {
            Root::Symbol(s) if reference.path.is_empty() => self.auto_kind(file, s),
            _ => Auto::No,
        };
        // Nothing but `[]` was ever assigned to it: where it is being filled it is an array of anything, whatever is in it
        // by then. Not looking spares asking what is being put in it while working out what that is expected to be.
        if auto == Auto::Array
            && let Root::Symbol(s) = reference.root
            && !bound.symbols[s.idx()].flags.contains(SymFlags::ASSIGNED)
            && bound.symbols[s.idx()].decls.len() == 1
            && self.is_evolving_array_operation_target(file, e)
        {
            if self.is_flow_too_deep(&reference, flow) {
                // `reportFlowControlError`
                self.p.flows_too_deep.insert((file, e), ());
                return TypeId::ERROR;
            }
            return declared;
        }
        let crossing = if !reference.path.is_empty() {
            // `getTypeAtFlowNode` stops at the start of a function for a property or element access expression. `a.b` in `typeof a.b`
            // is a qualified name, and goes on.
            if bound.is_in_type_query(e) {
                Crossing::Yes
            } else {
                Crossing::No
            }
        } else {
            match reference.root {
                Root::Symbol(s) => {
                    let flags = bound.symbols[s.idx()].flags;
                    if flags.contains(SymFlags::CONST) && auto != Auto::Array {
                        Crossing::Yes
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
        // `checkIdentifier`: in the function that declares it, it is `undefined` until something is assigned. In another one it is
        // whatever it was left as (`isOuterVariable`), unless nothing ever assigns to it (`isNeverInitialized`). For `x!` it is
        // `undefined` to begin with wherever that is written (`isAutomaticTypeInNonNull`).
        let mut initial = declared;
        if auto != Auto::No
            && let Root::Symbol(s) = reference.root
        {
            let is_outer = self.skip_invoked_fns(file, self.enclosing_fn_of_expr(file, e))
                != self.skip_invoked_fns(file, self.declaring_fn(file, s));
            if !is_outer
                || self.is_never_initialized(file, s)
                || self.is_operand_of_non_null(file, e)
            {
                initial = self.undefined_as_declared();
            }
        }
        // `removeOptionalityFromDeclaredType`: `(x: T | undefined = d)` starts out as something.
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
        let mut walk = Walk::new(reference, declared, initial, auto, false);
        walk.crossing = crossing;
        if starts_unassigned {
            self.start_unassigned(&mut walk);
        } else if is_variable && auto == Auto::No {
            // What finds out its type as it goes is taken to hold a value.
            walk.start = Start::Unsettled;
        }
        self.flow_depth += 1;
        let outer = std::mem::replace(&mut self.walk_declared, declared);
        let ty = self.flow_type(&mut walk, flow);
        self.walk_declared = outer;
        self.flow_depth -= 1;
        // errorType, and `reportFlowControlError`
        if walk.too_deep {
            self.p.flows_too_deep.insert((file, e), ());
            return TypeId::ERROR;
        }
        if walk.steps >= MAX_STEPS {
            return declared;
        }
        // Nothing is known of what cannot be reached, which is not the same as knowing there is nothing it can be.
        if ty == TypeId::NEVER
            && declared != TypeId::NEVER
            && !self.is_reachable_by_walk(&walk, flow)
        {
            return declared;
        }
        // `newFlowType`: an incomplete `never` is `silentNeverType`.
        self.met_loop_under_way |= ty == TypeId::NEVER && walk.incomplete;
        if let TypeData::EvolvingArray(_) = self.data(ty) {
            // `getFlowTypeOfReference`: what is done to fill it is done to an array of anything (`autoArrayType`), whatever the
            // variable is declared as.
            return if self.is_evolving_array_operation_target(file, e) {
                self.array_of(TypeId::ANY)
            } else {
                self.finalize_evolving_array(ty)
            };
        }
        // `checkIdentifier`: of one that is being filled before there is anything to fill, 2454 is said, and it is what it is declared as.
        if auto != Auto::No
            && walk.initial.is_undefined()
            && self.contains_undefined(ty)
            && self.is_evolving_array_operation_target(file, e)
        {
            return declared;
        }
        // `x!` where all that is left of `x` is what `!` takes away: back to the declared type.
        if ty != TypeId::NEVER
            && self.is_operand_of_non_null(file, e)
            && self.type_with_facts(ty, facts::NE_UNDEFINED_OR_NULL) == TypeId::NEVER
        {
            return declared;
        }
        // `checkIdentifier`, `isAutomaticTypeInNonNull`
        if auto != Auto::No && self.is_operand_of_non_null(file, e) {
            return self.non_nullable(ty);
        }
        ty
    }

    /// `getFlowTypeOfDestructuring` of what a pattern binds. `const { a } = o.p`: `a` is whatever `o.p.a` is known to be there.
    pub(super) fn narrow_destructured(
        &mut self,
        file: FileId,
        pat: PatId,
        declared: TypeId,
    ) -> TypeId {
        if declared == TypeId::UNRESOLVED
            || declared == TypeId::NEVER
            || declared == TypeId::VOID
            || declared == TypeId::SYMBOL
        {
            return declared;
        }
        let hir = self.hir(file);
        let bound = self.bound(file);
        // From the inside out.
        let mut names = [Atom::NONE; 6];
        let mut count = 0;
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
                    let mut digits = [0u8; 10];
                    let mut from = digits.len();
                    let mut index = e.0 - elems.start;
                    loop {
                        from -= 1;
                        digits[from] = b'0' + (index % 10) as u8;
                        index /= 10;
                        if index == 0 {
                            break;
                        }
                    }
                    Some(self.files().atoms.intern(&digits[from..]))
                }
                PatParent::Var(d) => break hir[d].init,
                _ => return declared,
            };
            let Some(name) = name else { return declared };
            // `getLiteralPropertyNameText`: a string or a number, not a symbol.
            if count == names.len() || self.files().atoms.is_symbol_name(name) {
                return declared;
            }
            names[count] = name;
            count += 1;
        };
        self.narrow_path_of(file, init, &names[..count], declared)
    }

    /// `getFlowTypeOfDestructuring` of `e`, an element of an array literal or the value of a property of an object literal that is
    /// assigned to, as it stands there, default and all. `({ a } = o.p)`: `a` is given whatever `o.p.a` is known to be there.
    pub(super) fn narrow_destructured_assignment(
        &mut self,
        file: FileId,
        e: ExprId,
        declared: TypeId,
    ) -> TypeId {
        if declared == TypeId::UNRESOLVED
            || declared == TypeId::NEVER
            || declared == TypeId::VOID
            || declared == TypeId::SYMBOL
        {
            return declared;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        // From the inside out.
        let mut names = [Atom::NONE; 6];
        let mut count = 0;
        let mut at = e;
        // `getParentElementAccess`. It goes by what is written right around a literal: one in parentheses is in nothing it knows.
        let init = loop {
            if count > 0 && is_parenthesized(hir, at) {
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
                    // The literal as a whole: what is on the right of it, be that the default of an element.
                    ExprKind::Assign {
                        op: None,
                        target,
                        value,
                    } if count > 0 && target == at => break value,
                    _ => return declared,
                },
                _ => return declared,
            };
            let Some(name) = name else { return declared };
            // `getLiteralPropertyNameText`: a string or a number, not a symbol.
            if count == names.len() || self.files().atoms.is_symbol_name(name) {
                return declared;
            }
            names[count] = name;
            count += 1;
        };
        self.narrow_path_of(file, init, &names[..count], declared)
    }

    /// `getSyntheticElementAccess`, and `getFlowTypeOfReference` of it: what `init.a.b`, declared as `declared`, is known to be where
    /// `init` is written. `names`: `b`, `a`, from the inside out.
    fn narrow_path_of(
        &mut self,
        file: FileId,
        init: ExprId,
        names: &[Atom],
        declared: TypeId,
    ) -> TypeId {
        // What is in parentheses is not told where control is, no more than a call or a comma is.
        if init.is_none() || is_parenthesized(self.hir(file), init) {
            return declared;
        }
        let flow = self.bound(file).expr_flow[init.idx()];
        if flow == UNREACHABLE || flow.is_none() || self.flow_depth > 12 {
            return declared;
        }
        let Some(mut reference) = self.reference_of(file, init) else {
            return declared;
        };
        reference.path.extend(names.iter().rev().copied());
        // Nowhere is it written.
        reference.at = ExprId::NONE;
        let mut walk = Walk::new(reference, declared, declared, Auto::No, false);
        self.flow_depth += 1;
        let outer = std::mem::replace(&mut self.walk_declared, declared);
        let ty = self.flow_type(&mut walk, flow);
        self.walk_declared = outer;
        self.flow_depth -= 1;
        // Nothing is known of what cannot be reached.
        if walk.steps >= MAX_STEPS || ty == TypeId::NEVER && !self.is_reachable_by_walk(&walk, flow)
        {
            return declared;
        }
        ty
    }

    /// Whether `this.name`, declared as `declared`, has been given a value by the time the constructor `func` is left.
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
        let mut walk = Walk::new(reference, declared, initial, Auto::No, false);
        self.flow_depth += 1;
        let outer = std::mem::replace(&mut self.walk_declared, declared);
        let ty = self.flow_type(&mut walk, exit);
        self.walk_declared = outer;
        self.flow_depth -= 1;
        walk.steps >= MAX_STEPS || !self.contains_undefined(ty)
    }

    /// `getFlowTypeInConstructor`: what the property `name`, of which nothing is said, has been assigned by the time the
    /// constructor `func` is left. `None` if that is nothing to go by.
    pub(super) fn flow_type_in_constructor(
        &mut self,
        file: FileId,
        func: FnId,
        name: Atom,
    ) -> Option<TypeId> {
        let initial = self.undefined_as_declared();
        self.flow_type_in_constructor_from(file, func, name, initial)
    }

    /// `getFlowTypeInConstructor`, with the initial type `getFlowTypeOfProperty` starts from: the type of the property in the base
    /// class, else `undefined`.
    pub(super) fn flow_type_in_constructor_from(
        &mut self,
        file: FileId,
        func: FnId,
        name: Atom,
        initial: TypeId,
    ) -> Option<TypeId> {
        let exit = self.bound(file).fns[func.idx()].exit;
        if exit.is_none() || self.flow_depth > 12 {
            return None;
        }
        // `getTypeAtFlowNode`: an unreachable flow node has `convertAutoToAny(declaredType)`.
        if exit == UNREACHABLE {
            return Some(TypeId::ANY);
        }
        let reference = Reference {
            file,
            root: Root::This,
            path: smallvec![name],
            at: ExprId::NONE,
            has_key: true,
        };
        let mut walk = Walk::new(reference, TypeId::ANY, initial, Auto::Value, false);
        self.flow_depth += 1;
        let outer = std::mem::replace(&mut self.walk_declared, TypeId::ANY);
        let ty = self.flow_type(&mut walk, exit);
        self.walk_declared = outer;
        self.flow_depth -= 1;
        if walk.steps >= MAX_STEPS {
            return None;
        }
        // `unreachableNeverType` gives the declared type.
        if ty == TypeId::NEVER && !self.is_reachable_by_walk(&walk, exit) {
            return Some(TypeId::ANY);
        }
        let ty = if let TypeData::EvolvingArray(_) = self.data(ty) {
            self.finalize_evolving_array(ty)
        } else {
            ty
        };
        if self.is_every_type_nullable(ty) {
            return None;
        }
        Some(ty)
    }

    /// `getFlowTypeOfProperty`: the flow type of `e`, an access to a property whose declared type is `autoType` in the constructor
    /// around `e`. `initial`: the type of the property in the base class, else `undefined`.
    pub(super) fn flow_type_of_property(
        &mut self,
        file: FileId,
        e: ExprId,
        initial: TypeId,
    ) -> TypeId {
        let flow = self.bound(file).expr_flow[e.idx()];
        // `getTypeAtFlowNode`: an unreachable flow node has `convertAutoToAny(declaredType)`.
        if flow == UNREACHABLE || self.flow_depth > 12 {
            return TypeId::ANY;
        }
        let Some(reference) = self.reference_of(file, e) else {
            return TypeId::ANY;
        };
        let mut walk = Walk::new(reference, TypeId::ANY, initial, Auto::Value, false);
        self.flow_depth += 1;
        let outer = std::mem::replace(&mut self.walk_declared, TypeId::ANY);
        let ty = self.flow_type(&mut walk, flow);
        self.walk_declared = outer;
        self.flow_depth -= 1;
        // errorType, and `reportFlowControlError`
        if walk.too_deep {
            self.p.flows_too_deep.insert((file, e), ());
            return TypeId::ERROR;
        }
        if walk.steps >= MAX_STEPS {
            return TypeId::ANY;
        }
        // `unreachableNeverType` gives the declared type.
        if ty == TypeId::NEVER && !self.is_reachable_by_walk(&walk, flow) {
            return TypeId::ANY;
        }
        // `newFlowType`: an incomplete `never` is `silentNeverType`.
        self.met_loop_under_way |= ty == TypeId::NEVER && walk.incomplete;
        if let TypeData::EvolvingArray(_) = self.data(ty) {
            // `autoArrayType` for the target of `push`, `unshift`, `length` and `x[n] = v`.
            return if self.is_evolving_array_operation_target(file, e) {
                self.array_of(TypeId::ANY)
            } else {
                self.finalize_evolving_array(ty)
            };
        }
        // `x!` where only `null` or `undefined` is left gives the declared type.
        if ty != TypeId::NEVER
            && self.is_operand_of_non_null(file, e)
            && self.type_with_facts(ty, facts::NE_UNDEFINED_OR_NULL) == TypeId::NEVER
        {
            return TypeId::ANY;
        }
        ty
    }

    pub(super) fn may_be_unassigned(&mut self, file: FileId, e: ExprId, declared: TypeId) -> bool {
        self.starts_unassigned = true;
        let ty = self.flow_type_of(file, e, declared, false);
        self.contains_undefined(ty)
    }

    /// Whether the variable finds out its type as it goes: `getTypeForVariableLikeDeclaration` gives `autoType` or `autoArrayType` for
    /// its first declaration (`symbol.ValueDeclaration`), however many more there are.
    pub(super) fn auto_kind(&self, file: FileId, symbol: SymbolId) -> Auto {
        let hir = self.hir(file);
        let bound = self.bound(file);
        // Only where an implicit `any` would be an error is the trouble taken to find something better.
        if !self.p.files.options.no_implicit_any {
            return Auto::No;
        }
        let s = &bound.symbols[symbol.idx()];
        // A type of the same name may be declared first.
        let is_variable = |d: &Decl| matches!(d, Decl::Var(_) | Decl::Param(_));
        let Some(&Decl::Var(pat)) = s.decls.iter().find(|&d| is_variable(d)) else {
            return Auto::No;
        };
        let PatParent::Var(d) = bound.pat_parent[pat.idx()] else {
            return Auto::No;
        };
        let decl = &hir[d];
        if decl.ty.is_some()
            || decl.flags.intersects(Flags::EXPORT | Flags::AMBIENT)
            || hir.kind == FileKind::Declaration
        {
            return Auto::No;
        }
        let is_constant = matches!(
            decl.kind,
            VarKind::Const | VarKind::Using | VarKind::AwaitUsing
        );
        // It goes by how the initializer is written: `null!` and `[] satisfies T` are something else.
        let kind = if decl.init.is_none() {
            if is_constant { Auto::No } else { Auto::Value }
        } else {
            match hir[decl.init].kind {
                // `isNullOrUndefined`
                ExprKind::Null if !is_constant => Auto::Value,
                ExprKind::Ident(known::undefined)
                    if !is_constant && bound.expr_symbol[decl.init.idx()].is_none() =>
                {
                    Auto::Value
                }
                // `isEmptyArrayLiteral`, which does not look into parentheses.
                ExprKind::Array(items) if items.is_empty() && !is_parenthesized(hir, decl.init) => {
                    Auto::Array
                }
                _ => Auto::No,
            }
        };
        if kind == Auto::No {
            return kind;
        }
        // Of a global that several files declare, the first of all has the say. What another file declares is not followed here.
        if s.flags.contains(SymFlags::MERGED) {
            let sym = self.files().sym(file, symbol);
            if self
                .files()
                .decls_of(sym)
                .into_iter()
                .find(|(_, d)| is_variable(d))
                != Some((file, Decl::Var(pat)))
            {
                return Auto::No;
            }
        }
        let stmt = bound.var_stmt[d.idx()];
        if stmt.is_none() || !matches!(hir[stmt].kind, StmtKind::Var(_)) {
            return Auto::No;
        }
        if let crate::bind::Parent::Stmt(parent) = bound.stmt_parent[stmt.idx()]
            && matches!(hir[parent].kind, StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. } if left == stmt)
        {
            return Auto::No;
        }
        kind
    }

    fn declaring_fn(&self, file: FileId, symbol: SymbolId) -> Option<FnId> {
        let bound = self.bound(file);
        let mut pat = match bound.symbols[symbol.idx()].decls.first() {
            Some(&(Decl::Var(pat) | Decl::Param(pat))) => pat,
            _ => return None,
        };
        loop {
            match bound.pat_parent[pat.idx()] {
                PatParent::Prop(parent, _) | PatParent::Elem(parent, _) => pat = parent,
                PatParent::Var(d) => {
                    return self
                        .enclosing_fn(file, crate::bind::Parent::Stmt(bound.var_stmt[d.idx()]));
                }
                PatParent::Param(p) => return Some(bound.param_fn[p.idx()]),
                PatParent::None => return None,
            }
        }
    }

    /// `getControlFlowContainer`: a function that is called where it is written is part of what is around it.
    fn skip_invoked_fns(&self, file: FileId, mut func: Option<FnId>) -> Option<FnId> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        while let Some(f) = func
            && let Some(call) = bound.get_immediately_invoked_function_expression(hir, f)
        {
            func = self.enclosing_fn_of_expr(file, hir[call].callee);
        }
        func
    }

    /// `isNeverInitialized`: a local `let` without a value that nothing assigns to. `x++` and `x += 1` do not count
    /// (`isSymbolAssignedDefinitely`).
    fn is_never_initialized(&self, file: FileId, symbol: SymbolId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let Some(&Decl::Var(pat)) = bound.symbols[symbol.idx()].decls.first() else {
            return false;
        };
        let PatParent::Var(d) = bound.pat_parent[pat.idx()] else {
            return false;
        };
        let (decl, stmt) = (&hir[d], bound.var_stmt[d.idx()]);
        if decl.kind != VarKind::Let
            || decl.init.is_some()
            || decl.flags.intersects(Flags::EXPORT | Flags::DEFINITE)
        {
            return false;
        }
        if stmt.is_none() || !matches!(hir[stmt].kind, StmtKind::Var(_)) {
            return false;
        }
        match bound.stmt_parent[stmt.idx()] {
            Parent::Stmt(owner) if matches!(hir[owner].kind, StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. } if left == stmt) =>
            {
                return false;
            }
            Parent::File if !self.files().modules[file.idx()].is_module() => return false,
            _ => {}
        }
        !bound.is_symbol_assigned_definitely(hir, symbol)
    }

    /// `markNodeAssignmentsWorker`: what `export { x }` names may be assigned to at any time, for all that can be seen from here.
    fn is_named_by_export_specifier(&self, file: FileId, symbol: SymbolId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let name = bound.symbols[symbol.idx()].name;
        hir.exports.iter().enumerate().any(|(i, export)| {
            export.spec.is_none()
                && !export.type_only
                && export
                    .items
                    .iter()
                    .any(|s| hir[s].local == name && !hir[s].type_only)
                && bound.resolve(bound.export_scope[i], name, SymFlags::VALUE) == Some(symbol)
        })
    }

    /// The node around the node `parent` stands for, going out of functions and classes too. `None` also for what is not kept track
    /// of: the default of a binding element, a computed name, the initializer of an enum member, `extends`, a decorator, the body
    /// of a namespace, and what is in a signature or in a member of an interface or a type literal.
    #[inline]
    pub fn parent_of(&self, file: FileId, parent: crate::bind::Parent) -> crate::bind::Parent {
        use crate::bind::{ClassOwner, FnOwner, MemberOwner, Parent};
        let bound = self.bound(file);
        let of_member = |m: MemberId| match bound.member_owner[m.idx()] {
            MemberOwner::Class(c) => match bound.class_owner[c.idx()] {
                ClassOwner::Expr(e) => Parent::Expr(e),
                ClassOwner::Stmt(s) => Parent::Stmt(s),
            },
            _ => Parent::None,
        };
        let of_fn = |f: FnId| match bound.fns[f.idx()].owner {
            FnOwner::Expr(e) => Parent::Expr(e),
            FnOwner::Stmt(s) => Parent::Stmt(s),
            FnOwner::Member(m) => of_member(m),
            _ => Parent::None,
        };
        match parent {
            Parent::Expr(e) => bound.expr_parent[e.idx()],
            Parent::Stmt(s) if s.is_none() => Parent::None,
            Parent::Stmt(s) => bound.stmt_parent[s.idx()],
            Parent::VarInit(d) => Parent::Stmt(bound.var_stmt[d.idx()]),
            Parent::Prop(p) => Parent::Expr(bound.prop_owner[p.idx()]),
            Parent::Case(c) => Parent::Stmt(bound.case_stmt[c.idx()]),
            Parent::FnBody(f) => of_fn(f),
            Parent::ParamDefault(p) => of_fn(bound.param_fn[p.idx()]),
            Parent::MemberInit(m) => of_member(m),
            _ => Parent::None,
        }
    }

    /// `FindAncestor(e, IsFunctionOrSourceFile)`: the function `e` is written in, be it in the default of a binding element or in a
    /// class that is written there.
    fn function_around(&self, file: FileId, e: ExprId) -> Option<FnId> {
        let bound = self.bound(file);
        let mut at = bound.expr_parent[e.idx()];
        loop {
            match at {
                Parent::FnBody(f) => return Some(f),
                Parent::ParamDefault(p) => return Some(bound.param_fn[p.idx()]),
                Parent::None | Parent::File | Parent::Module(_) => return None,
                _ => at = self.outward(file, at),
            }
        }
    }

    /// Whether a parameter or a `let` is not assigned to any more once `e` has been reached, so that what is known of it
    /// there still holds when a function created there runs.
    pub(super) fn is_past_last_assignment(
        &mut self,
        file: FileId,
        symbol: SymbolId,
        e: ExprId,
    ) -> bool {
        use crate::bind::Parent;
        let hir = self.hir(file);
        let bound = self.bound(file);
        let s = &bound.symbols[symbol.idx()];
        let Some(&(Decl::Var(pat) | Decl::Param(pat))) = s.decls.first() else {
            return false;
        };
        // `isParameterOrMutableLocalVariable`: `var` is out, a constant too, and so is what other files or scripts can reach.
        let mut root = pat;
        let is_local = loop {
            match bound.pat_parent[root.idx()] {
                PatParent::Prop(parent, _) | PatParent::Elem(parent, _) => root = parent,
                PatParent::Param(_) => break true,
                PatParent::Var(d) => {
                    let stmt = bound.var_stmt[d.idx()];
                    let is_catch = stmt.is_some() && matches!(hir[stmt].kind, StmtKind::Try { .. });
                    let is_global = !self.files().modules[file.idx()].is_module()
                        && stmt.is_some()
                        && matches!(bound.stmt_parent[stmt.idx()], Parent::File);
                    break is_catch
                        || (hir[d].kind == VarKind::Let
                            && !hir[d].flags.contains(Flags::EXPORT)
                            && !is_global);
                }
                PatParent::None => break false,
            }
        };
        if !is_local || !hir.exports.is_empty() && self.is_named_by_export_specifier(file, symbol) {
            return false;
        }
        if !s.flags.contains(SymFlags::ASSIGNED) {
            return true;
        }
        let declared_at = hir[pat].pos;
        let declaring = self.declaring_fn(file, symbol);
        let from = bound.assignments.partition_point(|a| a.0.0 < symbol.0);
        for &(_, assignment) in bound.assignments[from..]
            .iter()
            .take_while(|a| a.0 == symbol)
        {
            if self.function_around(file, assignment) != declaring {
                return false;
            }
            // The assignment counts as going on until the end of the outermost statement it is in, since that may loop.
            let mut outermost = None;
            let mut at = bound.expr_parent[assignment.idx()];
            loop {
                match at {
                    Parent::None | Parent::File | Parent::FnBody(_) | Parent::Module(_) => break,
                    Parent::Stmt(stmt) if stmt.is_some() => {
                        if hir[stmt].pos <= declared_at {
                            break;
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
                            outermost = Some(stmt);
                        }
                    }
                    _ => {}
                }
                at = self.outward(file, at);
            }
            let Some(outermost) = outermost else {
                if hir[assignment].pos >= hir[e].pos {
                    return false;
                }
                continue;
            };
            if hir[e].pos <= hir[outermost].pos {
                return false;
            }
            let mut at = bound.expr_parent[e.idx()];
            loop {
                match at {
                    Parent::None | Parent::File => break,
                    Parent::Stmt(stmt) if stmt == outermost => return false,
                    _ => {}
                }
                at = self.outward(file, at);
            }
        }
        true
    }

    fn evolving_array(&mut self, element: TypeId) -> TypeId {
        self.intern(TypeData::EvolvingArray(element))
    }

    fn finalize_evolving_array(&mut self, ty: TypeId) -> TypeId {
        let TypeData::EvolvingArray(element) = *self.data(ty) else {
            return ty;
        };
        if element == TypeId::NEVER {
            return self.array_of(TypeId::ANY);
        }
        // An object literal is no subtype of one that lacks a property it has (`propertiesRelatedTo`): as alternatives to one another
        // they get each other's properties first. None is fresh in the array.
        let element = self.regular_object(element);
        let element = if self.is_union(element) {
            let parts = self.parts(element);
            self.union_reduced(parts)
        } else {
            element
        };
        self.array_of(element)
    }

    /// Where paths meet. Arrays that are still being filled stay so if that is all there is.
    /// What is no part of what the reference was to begin with has been brought in from outside, by
    /// `instanceof`, `in` or a type guard, and goes again where something it is a subtype of comes together with it.
    fn union_or_evolving(&mut self, types: &[TypeId], walk: &mut Walk) -> TypeId {
        if types.len() < 2 {
            return self.union_or_evolving_with(types, false);
        }
        let initial = self.initial_of(walk);
        let is_subset = |c: &Self, t: TypeId| {
            t == initial
                || t == TypeId::NEVER
                || c.is_union(initial) && c.parts(t).iter().all(|p| c.parts(initial).contains(p))
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
            // `recombineUnknownType`: the pieces `unknown` was taken apart into, all back together.
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
            // All the members of the declared type are the declared type.
            if union != self.walk_declared
                && let (TypeData::Union(parts), TypeData::Union(declared)) =
                    (self.data(union), self.data(self.walk_declared))
                && parts == declared
            {
                return self.walk_declared;
            }
            // `false | true` is `boolean` however fresh the two are: together they widen to it anyway.
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
                _ if t == TypeId::NEVER => {}
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
        // What is written right around `x.push` and `x[n]` is what counts: `(x.push)(v)` and `(x[n]) = v` are something else.
        match hir[parent].kind {
            ExprKind::Dot { obj, name, .. } if obj == root => {
                name == known::length
                    || (name == known::push || name == known::unshift)
                        && !is_parenthesized(hir, parent)
                        // A call it is in, be it as an argument.
                        && matches!(bound.expr_parent[parent.idx()], Parent::Expr(call) if matches!(hir[call].kind, ExprKind::Call(_)))
            }
            ExprKind::Index { obj, index, .. } if obj == root => {
                let Parent::Expr(assign) = bound.expr_parent[parent.idx()] else {
                    return false;
                };
                if is_parenthesized(hir, parent)
                    || !matches!(hir[assign].kind, ExprKind::Assign { op: None, target, .. } if target == parent)
                    || self.is_assignment_target(file, assign)
                {
                    return false;
                }
                // `isTypeAssignableToKind(.., NumberLike)`
                let index = self.type_of_expr(file, index);
                self.is_assignable(index, TypeId::NUMBER)
            }
            _ => false,
        }
    }

    /// The array `ty`, still being filled, after `value` was put in it.
    fn add_evolving_element(&mut self, file: FileId, ty: TypeId, value: ExprId) -> TypeId {
        let TypeData::EvolvingArray(element) = *self.data(ty) else {
            return ty;
        };
        let hir = self.hir(file);
        let added = match hir[value].kind {
            ExprKind::Spread(inner) => {
                let spread = self.type_of_expr(file, inner);
                self.iterated_type(spread, false)
            }
            _ => self.type_of_expr(file, value),
        };
        let added = self.base_type_of_literal_type(added);
        // `getRegularTypeOfObjectLiteral`: it stays the type of an object literal, and is widened with the others once the array is final.
        let added = if self.is_object_literal_type(added) {
            added
        } else {
            self.regular_object(added)
        };
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
    fn flow_type(&mut self, walk: &mut Walk, start: FlowId) -> TypeId {
        if walk.too_deep {
            return TypeId::ERROR;
        }
        let file = walk.reference.file;
        let bound = self.bound(file);
        // Tests met on the way back, to be applied on the way forward again.
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
        // How many tests were not put off because they are about something else. They count as if they had been.
        let mut passed = 0;
        let mut flow = start;
        let depth = walk.depth;
        let mut ty = loop {
            walk.steps += 1;
            if walk.steps >= MAX_STEPS {
                break walk.declared;
            }
            // This is one invocation of `getTypeAtFlowNode`, and what is put off stands for one more each, inside it.
            walk.depth = depth + 1 + pending.len() as u32 + passed;
            if walk.depth > MAX_FLOW_DEPTH {
                walk.too_deep = true;
                break TypeId::ERROR;
            }
            match bound.flow[flow.idx()] {
                Flow::Unreachable => break TypeId::NEVER,
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
                Flow::StartInvoked {
                    outer,
                    plain,
                    arrow,
                } => {
                    let goes_on = walk.reference.path.is_empty()
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
                    if plain || goes_on || self.settle_crossing(walk) {
                        flow = outer;
                        continue;
                    }
                    break self.initial_of(walk);
                }
                Flow::Assign { before, target } => {
                    // `getTypeAtFlowAssignment`: an assignment control does not get to leaves nothing behind.
                    if before == UNREACHABLE {
                        break TypeId::NEVER;
                    }
                    if let FlowTarget::Expr(e) = target
                        && self
                            .bound(file)
                            .get_assignment_target_kind(self.hir(file), e)
                            == AssignmentKind::Compound
                        && self.matches(&walk.reference, e)
                    {
                        pending.push(Pending::Compound);
                        flow = before;
                        continue;
                    }
                    match self.type_at_assignment(walk, target) {
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
                    // `getTypeAtFlowArrayMutation`: what is done to something else is passed by.
                    if walk.auto != Auto::No && self.is_mutation_of(&walk.reference, expr) {
                        pending.push(Pending::Mutation(expr));
                    }
                    flow = before;
                }
                Flow::Cond {
                    before,
                    expr,
                    sense,
                } => {
                    // An array that is being filled is looked at by every test.
                    if walk.auto != Auto::No || self.is_test_about(&walk.reference, flow, expr) {
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
                        let (sig, is_kept) = self.effects_signature_and_is_kept(file, call);
                        if sig.is_some() {
                            pending.push(Pending::Assert(call));
                        } else if is_kept {
                            self.note_idle_call(file, flow);
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
                    break t;
                }
                Flow::Label { start, len } => {
                    // Where a `finally` block that is being gone back through starts: on with the ways in that count. Nothing
                    // before here depends on which those are, so what is found out from here on is as good as ever.
                    if let Some(at) = walk.reduced.iter().rposition(|r| r.0 == flow) {
                        let entry = walk.reduced.remove(at);
                        let t = self.flow_type(walk, entry.1);
                        walk.reduced.insert(at, entry);
                        break t;
                    }
                    if let Some(known) = walk.known_at(flow) {
                        break known;
                    }
                    let mut types: SmallVec<[TypeId; 4]> = SmallVec::new();
                    // The way past a `switch` none of whose cases matched. There is no such way if the cases cover everything,
                    // which is only asked when it would make a difference: the question can lead back here.
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
                        if t == walk.declared && self.starts_as_declared(walk) {
                            types.clear();
                            types.push(t);
                            settled = true;
                            break;
                        }
                        if !types.contains(&t) {
                            types.push(t);
                        }
                    }
                    if !settled && let Some((edge, stmt)) = bypass {
                        let t = self.flow_type(walk, edge);
                        if t != TypeId::NEVER
                            && !types.contains(&t)
                            && !self.is_exhaustive_switch(file, stmt)
                        {
                            if t == walk.declared && self.starts_as_declared(walk) {
                                types.clear();
                            }
                            types.push(t);
                        }
                    }
                    let t = self.union_or_evolving(&types, walk);
                    walk.remember(flow, t);
                    break t;
                }
                Flow::Loop { start, len } => {
                    // `getTypeAtFlowLoopLabel`: what has no key is what it is declared as where a loop comes round.
                    if len > 1 && !walk.reference.has_key {
                        break walk.declared;
                    }
                    if let Some(&(_, so_far)) = walk.loops.iter().find(|l| l.0 == flow) {
                        break so_far;
                    }
                    let initial = if self.flow_loops.is_empty() {
                        walk.initial
                    } else {
                        self.initial_of(walk)
                    };
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
                            walk.incomplete = true;
                            break so_far;
                        }
                    }
                    if let Some(known) = walk.known_at(flow) {
                        break known;
                    }
                    let edges = bound.edges(start, len);
                    // A loop nothing leads to: `while (true) {}` came before.
                    if edges.is_empty() {
                        break TypeId::NEVER;
                    }
                    // `getTypeAtFlowLoopLabel`: what is the declared type can only be added subtypes to. Unlike where branches meet, what
                    // it was to begin with is not looked at.
                    let entry = self.flow_type(walk, edges[0]);
                    if entry == walk.declared {
                        break entry;
                    }
                    // The result is incomplete only if the first antecedent is.
                    let incomplete = walk.incomplete;
                    // One pass: each back edge sees the types of the antecedents before it.
                    let mut types: SmallVec<[TypeId; 4]> = smallvec![entry];
                    walk.loops.push((flow, entry));
                    walk.round_labels.push(Labels::default());
                    let initial = self.initial_of(walk);
                    self.flow_loops.push((
                        flow,
                        walk.reference.clone(),
                        walk.declared,
                        initial,
                        entry,
                        self.stack.len(),
                    ));
                    for &edge in &edges[1..] {
                        let t = self.flow_type(walk, edge);
                        if t == walk.declared {
                            types.push(t);
                            break;
                        }
                        if !types.contains(&t) {
                            types.push(t);
                            let so_far = self.union_or_evolving_with(&types, false);
                            if let Some(own) = walk.loops.last_mut() {
                                own.1 = so_far;
                            }
                            if let Some(shared) = self.flow_loops.last_mut() {
                                shared.4 = so_far;
                            }
                        }
                    }
                    self.flow_loops.pop();
                    walk.round_labels.pop();
                    walk.loops.pop();
                    walk.incomplete = incomplete;
                    let result = self.union_or_evolving(&types, walk);
                    walk.remember(flow, result);
                    break result;
                }
            }
        };
        walk.depth = depth;
        if walk.too_deep {
            return TypeId::ERROR;
        }
        let reference = &walk.reference;
        while let Some(p) = pending.pop() {
            if ty == TypeId::NEVER {
                break;
            }
            // A test sees the array as it would be read; if it says nothing, the array goes on being filled.
            let seen = self.finalize_evolving_array(ty);
            let narrowed = match p {
                Pending::Cond(expr, sense) => self.narrow(reference, seen, expr, sense),
                Pending::Switch(stmt, from, to) => {
                    self.narrow_by_switch(reference, seen, stmt, from as usize, to as usize)
                }
                Pending::Assert(call) => self.narrow_by_assertion(reference, seen, call),
                Pending::Compound => self.base_type_of_literal_type(seen),
                Pending::Mutation(expr) => {
                    ty = self.after_array_mutation(file, ty, expr);
                    continue;
                }
                // Of the array as it would be read: it is not filled any further.
                Pending::NonNull => {
                    ty = self.non_nullable_type_if_needed(seen);
                    continue;
                }
            };
            if narrowed != seen {
                ty = narrowed;
            }
        }
        ty
    }

    /// `checkNonNullTypeWithReporter`: `ty` without `null` and `undefined`, where it has to be neither. `report` is told what is wrong
    /// with `ty`, if anything is.
    pub(super) fn check_non_null_type_with_reporter(
        &mut self,
        ty: TypeId,
        report: impl FnOnce(&mut Self, NonNullError),
    ) -> TypeId {
        // Most types have neither fact, which shows in their kind.
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
        if non_nullable == TypeId::NEVER || non_nullable.is_null() || non_nullable.is_undefined() {
            TypeId::ERROR
        } else {
            non_nullable
        }
    }

    /// `checkNonNullType`, less what it reports.
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

    /// `getTypeOfExpression` of `value`, which is assigned to the reference of `walk`. While a loop is being analysed the reference can
    /// be `silentNeverType`. There is no such type here: NEVER is returned where TypeScript has it.
    fn assigned_type(&mut self, walk: &mut Walk, value: ExprId) -> TypeId {
        let file = walk.reference.file;
        if self.flow_loops.is_empty() || value.is_none() {
            return self.type_of_declaration_initializer(file, value);
        }
        let outer = std::mem::replace(&mut self.met_loop_under_way, false);
        let ty = self.type_of_declaration_initializer(file, value);
        let met_silent_never = std::mem::replace(&mut self.met_loop_under_way, outer);
        if !met_silent_never {
            return ty;
        }
        // `checkConditionalExpression`: the union drops a branch that is `silentNeverType`.
        if let ExprKind::Cond { yes, no, .. } = self.hir(file)[value].kind {
            let (yes, no) = (self.assigned_type(walk, yes), self.assigned_type(walk, no));
            return self.union_reduced(&[yes, no]);
        }
        if self.propagates_silent_never(&walk.reference, value) {
            // It stays `silentNeverType` by identity wherever the walk carries it.
            walk.incomplete = true;
            return TypeId::NEVER;
        }
        // Any other expression was typed from a plain `never`, where a property access is an error of type `any`. Such an `any` says
        // nothing: `value` is typed again from a separate analysis of the loop.
        if self.is_any(ty) {
            self.type_of_expr_outside_loops(file, value)
        } else {
            ty
        }
    }

    /// Whether `e` is `silentNeverType` when `reference` is: `e` is the reference, or an operation that returns an operand that is
    /// `silentNeverType`. `checkPropertyAccessExpressionOrQualifiedName`, `checkElementAccessExpression`, `resolveCallExpression`,
    /// `resolveNewExpression`, `getInstantiationExpressionType`, `checkPrefixUnaryExpression`, `checkPostfixUnaryExpression`,
    /// `checkBinaryLikeExpression`, `checkInstanceOfExpression`, `checkInExpression`
    fn propagates_silent_never(&mut self, reference: &Reference, e: ExprId) -> bool {
        if e.is_none() {
            return false;
        }
        let hir = self.hir(reference.file);
        match hir[e].kind {
            // The type of an assignment is the type of its right operand.
            ExprKind::Assign {
                op: None, value, ..
            } => self.propagates_silent_never(reference, value),
            _ if self.matches(reference, e) => true,
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => {
                self.propagates_silent_never(reference, obj)
            }
            ExprKind::Call(c) | ExprKind::New(c) => {
                self.propagates_silent_never(reference, hir[c].callee)
            }
            ExprKind::NonNull(x)
            | ExprKind::AsConst(x)
            | ExprKind::Await(x)
            | ExprKind::Satisfies { expr: x, .. }
            | ExprKind::Instantiation { expr: x, .. } => self.propagates_silent_never(reference, x),
            ExprKind::Unary { op, operand } => {
                !matches!(op, UnOp::Typeof | UnOp::Void | UnOp::Delete)
                    && self.propagates_silent_never(reference, operand)
            }
            ExprKind::Binary { op, left, right } => match op {
                BinOp::Lt
                | BinOp::Le
                | BinOp::Gt
                | BinOp::Ge
                | BinOp::EqEq
                | BinOp::NotEq
                | BinOp::EqEqEq
                | BinOp::NotEqEq => false,
                // `never` has no type facts, so `&&`, `||` and `??` return their left operand.
                BinOp::And | BinOp::Or | BinOp::Nullish => {
                    self.propagates_silent_never(reference, left)
                }
                BinOp::Comma => self.propagates_silent_never(reference, right),
                // The arithmetic operators, `+`, `in` and `instanceof`.
                _ => {
                    self.propagates_silent_never(reference, left)
                        || self.propagates_silent_never(reference, right)
                }
            },
            _ => false,
        }
    }

    /// `getAssignmentReducedType`, of a union and something other than `any`, `never` and the union itself.
    fn assignment_reduced_type(&mut self, declared: TypeId, assigned: TypeId) -> TypeId {
        let key = (declared, assigned);
        if let Some(&known) = self.flow_memo.assignment_reduced_types.get(&key) {
            return known;
        }
        let (reduced, is_memoizable) =
            self.run_memoizable(|c| c.assignment_reduced_type_uncached(declared, assigned));
        if is_memoizable {
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

    /// What the reference is right after `target` was assigned. `None`: the assignment is to something else.
    fn type_at_assignment(&mut self, walk: &mut Walk, target: FlowTarget) -> Option<TypeId> {
        let file = walk.reference.file;
        let hir = self.hir(file);
        let bound = self.bound(file);
        // `getInitialOrAssignedType`: what is assigned counts the way the reference itself does (`getNarrowableTypeForReference`).
        let at = walk.reference.at;
        let narrowable = |c: &mut Self, assigned: TypeId| {
            if at.is_some() {
                c.narrowable_type(file, at, assigned)
            } else {
                assigned
            }
        };
        // `getAssignmentReducedType`
        let reduce = |c: &mut Self, declared: TypeId, assigned: TypeId| -> TypeId {
            if !c.is_union(declared) {
                return declared;
            }
            let assigned = narrowable(c, assigned);
            if declared == assigned {
                return declared;
            }
            c.uncertain |= !c.is_known(assigned);
            if c.is_any(assigned) {
                return declared;
            }
            if assigned == TypeId::NEVER {
                return assigned;
            }
            c.assignment_reduced_type(declared, assigned)
        };
        let auto = walk.auto;
        // `isTypeAssignableTo(assignedType, declaredType)`: anything is assignable to `autoType`. `any`, `never`, arrays and tuples are
        // assignable to `autoArrayType`.
        let is_assignable_to_auto = |c: &Self, assigned: TypeId| {
            auto != Auto::Array
                || c.is_any(assigned)
                || assigned == TypeId::NEVER
                || c.every_type(assigned, |k, m| k.is_array(m) || k.is_tuple(m))
        };
        let assigned_to_auto = |c: &mut Self, walk: &mut Walk, value: ExprId| -> TypeId {
            // `isEmptyArrayAssignment`
            if matches!(hir[value].kind, ExprKind::Array(items) if items.is_empty())
                && !is_parenthesized(hir, value)
            {
                return c.evolving_array(TypeId::NEVER);
            }
            c.eager.push(c.stack.len());
            let assigned = c.assigned_type(walk, value);
            c.eager.pop();
            let assigned = narrowable(c, assigned);
            let assigned = c.widen_literal(assigned);
            if is_assignable_to_auto(c, assigned) {
                assigned
            } else {
                c.array_of(TypeId::ANY)
            }
        };
        match target {
            FlowTarget::Var(d) => {
                let symbol = bound.pat_symbol[hir[d].pat.idx()];
                if walk.reference.root != Root::Symbol(symbol) {
                    return None;
                }
                let init = hir[d].init;
                if !walk.reference.path.is_empty() {
                    // What is put on a function that a constant holds is looked for further back than the constant. In a JavaScript file
                    // that goes for any variable.
                    if (hir.is_js
                        || matches!(
                            hir[d].kind,
                            VarKind::Const | VarKind::Using | VarKind::AwaitUsing
                        ))
                        && init.is_some()
                        && matches!(hir[init].kind, ExprKind::Fn(f) if matches!(hir[f].kind, FnKind::Expr | FnKind::Arrow))
                        && !is_parenthesized(hir, init)
                    {
                        return None;
                    }
                    return Some(walk.declared);
                }
                if auto != Auto::No && init.is_some() {
                    return Some(assigned_to_auto(self, walk, init));
                }
                if init.is_none() {
                    return Some(walk.declared);
                }
                // What is assigned only matters if it can tell alternatives apart. It is not looked at otherwise, and may well
                // depend on this.
                if !self.is_union(walk.declared) {
                    return Some(walk.declared);
                }
                let assigned = self.assigned_type(walk, init);
                Some(reduce(self, walk.declared, assigned))
            }
            FlowTarget::Pat(p) => {
                if walk.reference.root != Root::Symbol(bound.pat_symbol[p.idx()]) {
                    return None;
                }
                if !walk.reference.path.is_empty()
                    || auto != Auto::No
                    || !self.is_union(walk.declared)
                {
                    return Some(walk.declared);
                }
                match self.initial_type_of_pat(file, p) {
                    Some(assigned) => Some(reduce(self, walk.declared, assigned)),
                    None => Some(walk.declared),
                }
            }
            FlowTarget::Expr(e) => {
                // `bindDeleteExpressionFlow`: only `delete a.b`, written just so, is an assignment.
                let mut operand = e;
                while let Parent::Expr(p) = bound.expr_parent[operand.idx()]
                    && matches!(
                        hir[p].kind,
                        ExprKind::NonNull(_)
                            | ExprKind::As { .. }
                            | ExprKind::Satisfies { .. }
                            | ExprKind::AsConst(_)
                    )
                {
                    operand = p;
                }
                let is_deleted = matches!(bound.expr_parent[operand.idx()], Parent::Expr(p) if matches!(hir[p].kind, ExprKind::Unary { op: UnOp::Delete, .. }));
                if is_deleted
                    && (operand != e
                        || !matches!(hir[e].kind, ExprKind::Dot { .. })
                        || is_parenthesized(hir, e))
                {
                    return None;
                }
                if self.matches(&walk.reference, e) {
                    // `x = v`, and `x ??= v` on the path where it assigns
                    if let crate::bind::Parent::Expr(parent) = bound.expr_parent[e.idx()]
                        && let ExprKind::Assign { op: None | Some(BinOp::And | BinOp::Or | BinOp::Nullish), target, value } = hir[parent].kind
                        && target == e
                        // Not `[x = d] = v`, where `d` is only for want of anything better.
                        && !self.is_assignment_target(file, parent)
                    {
                        if auto != Auto::No {
                            return Some(assigned_to_auto(self, walk, value));
                        }
                        let declared = if self.is_in_compound_like_assignment(file, e) {
                            self.base_type_of_literal_type(walk.declared)
                        } else {
                            walk.declared
                        };
                        if !self.is_union(declared) {
                            return Some(declared);
                        }
                        // `getTypeOfExpression` checks an expression again while it is being checked, and ends at the loop. `enter` refuses
                        // all but the reference itself, so a cycle through a value assigned on a back edge may not be one in TypeScript.
                        // `mark_circle_from` tells which are.
                        let in_loop = !walk.loops.is_empty();
                        if in_loop {
                            self.eager.push(self.stack.len());
                            self.loop_values.push(self.stack.len());
                        }
                        let assigned = self.assigned_type(walk, value);
                        if in_loop {
                            self.loop_values.pop();
                            self.eager.pop();
                        }
                        return Some(reduce(self, declared, assigned));
                    }
                    // `getAssignedType` of what is deleted is `undefined`.
                    if is_deleted {
                        return Some(if auto != Auto::No {
                            TypeId::UNDEFINED
                        } else {
                            reduce(self, walk.declared, TypeId::UNDEFINED)
                        });
                    }
                    if auto == Auto::No && !self.is_union(walk.declared) {
                        return Some(walk.declared);
                    }
                    // `[x] = v`, `({ a: x } = v)`
                    if let Some(assigned) = self.destructured_type(file, e) {
                        if auto != Auto::No {
                            let assigned = narrowable(self, assigned);
                            let assigned = self.widen_literal(assigned);
                            return Some(if is_assignable_to_auto(self, assigned) {
                                assigned
                            } else {
                                self.array_of(TypeId::ANY)
                            });
                        }
                        return Some(reduce(self, walk.declared, assigned));
                    }
                    return Some(walk.declared);
                }
                if self.is_proper_prefix(&walk.reference, e) {
                    return Some(walk.declared);
                }
                None
            }
        }
    }

    /// `getInitialType`: what the initializer gives `pat`. `None` where TypeScript has its error type.
    fn initial_type_of_pat(&mut self, file: FileId, pat: PatId) -> Option<TypeId> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let (ty, default) = match bound.pat_parent[pat.idx()] {
            PatParent::Var(d) if hir[d].init.is_some() => {
                return Some(self.type_of_declaration_initializer(file, hir[d].init));
            }
            // `getInitialTypeOfVariableDeclaration`
            PatParent::Var(d) => {
                let head = bound.var_stmt[d.idx()];
                if head.is_none() {
                    return None;
                }
                let Parent::Stmt(owner) = bound.stmt_parent[head.idx()] else {
                    return None;
                };
                if owner.is_none() {
                    return None;
                }
                return match hir[owner].kind {
                    StmtKind::ForIn { left, .. } if left == head => Some(TypeId::STRING),
                    StmtKind::ForOf {
                        left,
                        expr,
                        is_await,
                        ..
                    } if left == head => {
                        let iterable = self.type_of_expr(file, expr);
                        let iterable = self.non_nullable_type_if_needed(iterable);
                        Some(self.checked_iterated_type(iterable, is_await))
                    }
                    _ => None,
                };
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
                    ),
                    hir[elem].default,
                )
            }
        };
        // `getTypeWithDefault`
        if default.is_none() {
            return Some(ty);
        }
        let default = self.type_of_declaration_initializer(file, default);
        let ty = self.without_undefined(ty);
        Some(self.union(&[ty, default]))
    }

    /// `getAssignedType`, of what is inside the pattern of a destructuring assignment or stands in the head of `for (x in o)` or
    /// `for (x of xs)`. `None` for anything else.
    fn destructured_type(&mut self, file: FileId, e: ExprId) -> Option<TypeId> {
        use crate::bind::Parent;
        let (hir, bound) = (self.hir(file), self.bound(file));
        // What the pattern `p` as a whole is given.
        let given = |c: &mut Self, p: ExprId| -> Option<TypeId> {
            match bound.expr_parent[p.idx()] {
                Parent::Expr(outer) if matches!(hir[outer].kind, ExprKind::Assign { op: None, target, .. } if target == p) =>
                {
                    let ExprKind::Assign { value, .. } = hir[outer].kind else {
                        unreachable!()
                    };
                    // `[[a] = d] = v`: what is there, or else the default.
                    if c.is_assignment_target(file, outer) {
                        let ty = c.destructured_type(file, outer)?;
                        let (ty, default) = (c.without_undefined(ty), c.type_of_expr(file, value));
                        return Some(c.union(&[ty, default]));
                    }
                    Some(c.type_of_expr(file, value))
                }
                _ => c.destructured_type(file, p),
            }
        };
        match bound.expr_parent[e.idx()] {
            Parent::Expr(p) => match hir[p].kind {
                // `x = d` as an element: `x` is given what the element is, or else the default.
                ExprKind::Assign {
                    op: None,
                    target,
                    value,
                } if target == e && self.is_assignment_target(file, p) => {
                    let ty = self.destructured_type(file, p)?;
                    let (ty, default) =
                        (self.without_undefined(ty), self.type_of_expr(file, value));
                    Some(self.union(&[ty, default]))
                }
                ExprKind::Array(items) if self.is_assignment_target(file, p) => {
                    let index = hir.ids(items).position(|i| i == e)?;
                    let ty = given(self, p)?;
                    if self.every_type(ty, |c, m| c.is_tuple(m)) {
                        let key = self.number_literal(index as f64, false);
                        if let Some(element) = self.indexed_access_if_any(ty, key, false) {
                            return Some(element);
                        }
                    }
                    let element = self.iterated_type(ty, false);
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
                        || !self.is_assignment_target(file, list)
                    {
                        return None;
                    }
                    let ty = given(self, list)?;
                    let element = self.iterated_type(ty, false);
                    Some(self.array_of(element))
                }
                _ => None,
            },
            Parent::Prop(prop) => {
                let owner = bound.prop_owner[prop.idx()];
                if hir[prop].kind == PropKind::Spread || !self.is_assignment_target(file, owner) {
                    return None;
                }
                let name = self.member_name(file, hir[prop].key)?;
                let ty = given(self, owner)?;
                if let Some(found) = self.type_of_property(ty, name) {
                    return Some(found);
                }
                let key = self.string_literal(name, false);
                Some(
                    self.indexed_access_if_any(ty, key, true)
                        .unwrap_or(TypeId::ERROR),
                )
            }
            Parent::Stmt(left) => {
                let Parent::Stmt(owner) = bound.stmt_parent[left.idx()] else {
                    return None;
                };
                match hir[owner].kind {
                    StmtKind::ForIn { left: head, .. } if head == left => Some(TypeId::STRING),
                    // `checkRightHandSideOfForOf`: what is gone through is taken to be there (`checkNonNullExpression`).
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
            _ => None,
        }
    }

    /// Whether `target` is the `k` of `for (const k in x)`, where `x` is the reference or a chain that goes through it.
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

    /// Whether `expr`, `a.push(x)` or `a[i] = x`, is done to the reference. `(a.push)(x)` and `(a[i]) = x` fill nothing
    /// (`bindCallExpressionFlow`, `bindBinaryExpressionFlow`).
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

    /// Whether `getTypeAtFlowNode` gets `MAX_FLOW_DEPTH` deep going straight back from `flow`, for an array nothing is assigned to
    /// after its declaration. Nothing met is looked into, and where ways meet it is not followed any further.
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

    /// `getTypeAtFlowArrayMutation`: the array `ty` after `expr`, which is done to it.
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
                let index = self.type_of_expr(file, index);
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

    /// `getTypeOfDottedName`: the type of `e` as far as annotations say, without inferring anything.
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
                let apparent = self.apparent_type(obj);
                let (prop, mapper) = self.prop_ref(apparent, name)?;
                // `getExplicitTypeOfSymbol`: a method, or a property whose first declaration says its type. Not what a getter gives,
                // whatever it says.
                if prop.flags.contains(PropFlags::ACCESSOR) {
                    return None;
                }
                match &prop.source {
                    PropSource::Members(members) => {
                        let (f, m) = members[0];
                        let member = &self.hir(f)[m];
                        if member.kind == MemberKind::Property && member.ty.is_none() {
                            return None;
                        }
                    }
                    PropSource::Parameter(f, p) => {
                        if self.hir(*f)[*p].ty.is_none() {
                            return None;
                        }
                    }
                    PropSource::Literal(..) => return None,
                    PropSource::Symbol(sym) => {
                        self.explicit_type_of_symbol(*sym)?;
                    }
                    // `isExpandoPropertyFunctionWithReturnTypeAnnotation`
                    PropSource::Assigned(f, assignments) => {
                        let h = self.hir(*f);
                        let says_what_it_returns = assignments.first().is_some_and(|&first| {
                            matches!(h[first].kind, ExprKind::Assign { value, .. }
                                if !is_parenthesized(h, value) && matches!(h[value].kind, ExprKind::Fn(func) if h[func].ret.is_some()))
                        });
                        if !says_what_it_returns {
                            return None;
                        }
                    }
                    _ => {}
                }
                Some(self.type_of_prop(prop, mapper))
            }
            _ => None,
        }
    }

    /// `getExplicitTypeOfSymbol`, of what a name or an export of a namespace stands for.
    fn explicit_type_of_symbol(&mut self, sym: Sym) -> Option<TypeId> {
        // `for (var a of b) for (var b of a)`
        if self.is_stack_low() {
            return None;
        }
        let sym = self.files().resolve_alias_if_needed(sym)?;
        let flags = self.files().flags(sym);
        if flags.intersects(SymFlags::FUNCTION | SymFlags::CLASS | SymFlags::VALUE_MODULE) {
            return Some(self.type_of_symbol(sym));
        }
        if !flags.intersects(SymFlags::VARIABLE) {
            return None;
        }
        // `ValueDeclaration`: the first has the say. A type of the same name may be declared before it.
        let files = self.files();
        let (f, pat) = files.parts(sym).iter().find_map(|&part| {
            files
                .symbol(part)
                .decls
                .iter()
                .find_map(|&decl| match decl {
                    Decl::Var(pat) | Decl::Param(pat) => Some((part.file, pat)),
                    _ => None,
                })
        })?;
        let (hir, bound) = (self.hir(f), self.bound(f));
        match bound.pat_parent[pat.idx()] {
            // `isDeclarationWithExplicitTypeAnnotation`. It is the type of the variable: a parameter that may be left out may be `undefined`.
            PatParent::Param(p) if hir[p].ty.is_some() => Some(self.type_of_symbol(sym)),
            PatParent::Var(d) if hir[d].ty.is_some() => Some(self.type_of_symbol(sym)),
            // The variable of `for (const f of fs)` is what `fs` holds, as far as annotations say what `fs` is.
            PatParent::Var(d) => {
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
            _ => None,
        }
    }

    /// `getExplicitThisType`: what `this` is declared as. Nothing is narrowed, and what is around says nothing.
    fn explicit_this_type(&mut self, file: FileId, e: ExprId) -> Option<TypeId> {
        use crate::bind::{FnOwner, MemberOwner};
        let (class, is_static) = match self.this_container(file, e)? {
            Err(of_class) => of_class,
            Ok(func) => {
                let this_ty = self.hir(file)[func].this_ty;
                if this_ty.is_some() {
                    return Some(self.type_from_node(file, this_ty));
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

    /// `getEffectsSignature`, of a call that is a statement: the signature called, if it says that it asserts something or that it
    /// never returns.
    pub(super) fn effects_signature(&mut self, file: FileId, call: ExprId) -> Option<SigId> {
        self.effects_signature_and_is_kept(file, call).0
    }

    /// The same, and whether `effects_signatures` has it.
    fn effects_signature_and_is_kept(
        &mut self,
        file: FileId,
        call: ExprId,
    ) -> (Option<SigId>, bool) {
        if let Some(&known) = self.flow_memo.effects_signatures.get(&(file, call)) {
            return (known, true);
        }
        let mut took_resolving = false;
        let (sig, is_memoizable) =
            self.run_memoizable(|c| c.effects_signature_uncached(file, call, &mut took_resolving));
        // `explicit_type_of_symbol` says nothing where the stack is low.
        let is_kept = is_memoizable && !took_resolving && !self.is_stack_low();
        if is_kept {
            self.flow_memo.effects_signatures.insert((file, call), sig);
        }
        (sig, is_kept)
    }

    /// `effects_signatures` has `None` for the call of the flow node `flow`.
    #[inline(never)]
    fn note_idle_call(&mut self, file: FileId, flow: FlowId) {
        // Nearly all walks are in the file whose errors are being looked for.
        if self.checking != Some(file) {
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

    /// `took_resolving`: the answer is as good as the resolution of the call, which keeps track of that itself.
    fn effects_signature_uncached(
        &mut self,
        file: FileId,
        call: ExprId,
        took_resolving: &mut bool,
    ) -> Option<SigId> {
        let hir = self.hir(file);
        let ExprKind::Call(c) = hir[call].kind else {
            return None;
        };
        let callee = self.explicit_type(file, hir[c].callee)?;
        let sigs = self.signatures(callee, false);
        let sig = match sigs[..] {
            // That it asserts, or never returns, holds whatever its type arguments are. What it asserts is asked where that matters.
            [only] => only,
            // Which of several is meant takes resolving the call, if that can make a difference.
            _ => {
                if !sigs.iter().any(|&s| self.asserts_or_never_returns(s)) {
                    return None;
                }
                *took_resolving = true;
                self.resolve_call(file, call).sig?
            }
        };
        self.asserts_or_never_returns(sig).then_some(sig)
    }

    /// `hasTypePredicateOrNeverReturnType`, `x is T` aside: a call that is a statement makes nothing of that.
    fn asserts_or_never_returns(&mut self, sig: SigId) -> bool {
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
                asserts && predicate.is_some()
            }
            TypeNodeKind::Keyword(keyword) => keyword == Keyword::Never,
            // `getReturnTypeFromAnnotation`: `never` by another name.
            _ => {
                let returned = self.type_from_node(file, ret);
                self.force(returned) == TypeId::NEVER
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
                        .resolve_call(file, call)
                        .sig
                        .and_then(|s| self.sig_predicate(s))
                    {
                        Some(p) => p,
                        None => return ty,
                    }
                };
                self.apply_predicate(reference, ty, predicate, hir[c].args, receiver, true)
            }
            _ => TypeId::NEVER,
        }
    }

    /// Whether control can get to `flow`.
    pub(super) fn is_reachable(&mut self, file: FileId, flow: FlowId) -> bool {
        let mut seen: Vec<FlowId> = Vec::new();
        self.is_reachable_inner(file, flow, false, &mut seen, &mut Vec::new())
    }

    /// `out_of_arrows`: it is asked for a `this`, which an arrow function has from where it is written.
    fn is_reachable_inner(
        &mut self,
        file: FileId,
        mut flow: FlowId,
        out_of_arrows: bool,
        seen: &mut Vec<FlowId>,
        reduced: &mut Vec<(FlowId, FlowId)>,
    ) -> bool {
        let bound = self.bound(file);
        loop {
            match bound.flow[flow.idx()] {
                Flow::Unreachable => return false,
                Flow::Start { outer, arrow }
                    if outer.is_some()
                        && (self.reachability_crosses_functions || arrow && out_of_arrows) =>
                {
                    flow = outer
                }
                Flow::StartInvoked {
                    outer,
                    plain,
                    arrow,
                } if plain || self.reachability_crosses_functions || arrow && out_of_arrows => {
                    flow = outer
                }
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
                    if from == to
                        && !self.reachability_past_exhaustive_switches
                        && self.is_exhaustive_switch(file, stmt)
                    {
                        return false;
                    }
                    flow = before;
                }
                Flow::Reduce {
                    before,
                    label,
                    instead,
                } => {
                    reduced.push((label, instead));
                    let reachable = self.is_reachable_inner(
                        file,
                        before,
                        out_of_arrows,
                        &mut Vec::new(),
                        reduced,
                    );
                    reduced.pop();
                    return reachable;
                }
                Flow::Label { start, len } => {
                    if seen.contains(&flow) {
                        return false;
                    }
                    seen.push(flow);
                    let (start, len) = match reduced.iter().rev().find(|r| r.0 == flow) {
                        Some(&(_, instead)) => match bound.flow[instead.idx()] {
                            Flow::Label { start, len } => (start, len),
                            _ => (start, len),
                        },
                        None => (start, len),
                    };
                    return bound.edges(start, len).iter().any(|&edge| {
                        self.is_reachable_inner(file, edge, out_of_arrows, seen, reduced)
                    });
                }
                Flow::Loop { start, len } => match bound.edges(start, len).first() {
                    Some(&entry) if !seen.contains(&flow) => {
                        seen.push(flow);
                        flow = entry;
                    }
                    _ => return false,
                },
            }
        }
    }

    /// `checkExpressionCached`: the type of `e`, computed with an empty `flowLoopStack`. It is complete, whatever incomplete types the
    /// analyses started for it met.
    fn type_of_expr_outside_loops(&mut self, file: FileId, e: ExprId) -> TypeId {
        let loops = std::mem::take(&mut self.flow_loops);
        let met_silent_never = self.met_loop_under_way;
        let ty = self.type_of_expr(file, e);
        self.met_loop_under_way = met_silent_never;
        self.flow_loops = loops;
        ty
    }

    /// `computeExhaustiveSwitchStatement`: whether the cases cover everything the subject can be.
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
            let ty = self.force(ty);
            let ty = self.base_constraint_of(ty).unwrap_or(ty);
            if ty == TypeId::UNRESOLVED {
                return false;
            }
            let not_equal = not_equal_facts_from_typeof_switch(&witnesses, 0, 0);
            // What can be anything is covered by all that `typeof` can give.
            if self.has_any_flag(ty) || ty == TypeId::UNKNOWN {
                return facts::ALL_TYPEOF_NE & not_equal == facts::ALL_TYPEOF_NE;
            }
            // `someType` asks `never` itself, which has no facts: it has all of none.
            if ty == TypeId::NEVER {
                return not_equal != 0;
            }
            return !self
                .parts(ty)
                .iter()
                .any(|&m| self.type_facts(m, not_equal) == not_equal);
        }
        let ty = self.type_of_expr_outside_loops(file, expr);
        let ty = self.force(ty);
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
            let t = self.type_of_expr(file, test);
            let t = self.regular(t);
            // `isNeitherUnitTypeNorNever`
            if !self.is_unit(t) && t != TypeId::NEVER {
                return false;
            }
            tested.push(t);
        }
        // `eachTypeContainedIn`: the very types, not what compares equal to them.
        self.every_type(ty, |c, m| tested.contains(&c.with_freshness(m, false)))
    }

    // ───────────────────────────── the rest ─────────────────────────────

    /// `isInCompoundLikeAssignment`: `x = x + 1` is `x += 1` written out, and a `0` is not held to stay one.
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

    /// `getBaseTypeOfLiteralType`
    pub(super) fn base_type_of_literal_type(&mut self, ty: TypeId) -> TypeId {
        self.map_type(ty, |c, m| c.base_of_literal(m))
    }

    /// What can be assigned to `target`, the left of `=`, `||=`, `&&=` or `??=`, a place in a pattern that is assigned to, or the `x`
    /// of `for (x of xs)`: its type before any narrowing. UNRESOLVED stands for errorType. Of something that is not written to, or
    /// by `+=` and the like, what it is declared as.
    pub(super) fn declared_type_of_reference(&mut self, file: FileId, target: ExprId) -> TypeId {
        let hir = self.hir(file);
        let parent = self.bound(file).expr_parent[target.idx()];
        let is_target = self.is_assignment_target(file, target);
        // `AssignmentKindDefinite`
        let is_definite = is_target
            || matches!(parent, Parent::Expr(p)
                if matches!(hir[p].kind, ExprKind::Assign { op: Some(BinOp::Or | BinOp::And | BinOp::Nullish), target: written, .. } if written == target));
        // `IsWriteOnlyAccess`: `a.b ||= v` reads `a.b` as well, and the `a.b` of `[...a.b] = v` and `({ ...a.b } = v)` goes for read.
        let is_write_only = is_target
            && !match parent {
                Parent::Expr(p) => matches!(hir[p].kind, ExprKind::Spread(_)),
                Parent::Prop(p) => hir[p].kind == PropKind::Spread,
                _ => false,
            };
        // `getWidenedType(leftType)`: the property of an assignment target or of a callee is looked up in the widened object type.
        let is_widened = self.is_written_or_called(file, target);
        match hir[target].kind {
            ExprKind::Ident(name) => match self.symbol_of_identifier(file, target, name) {
                Some(sym) => {
                    let declared = self.type_of_symbol(sym);
                    if self.is_in_compound_like_assignment(file, target) {
                        self.base_type_of_literal_type(declared)
                    } else {
                        declared
                    }
                }
                None => TypeId::UNRESOLVED,
            },
            // `checkPropertyAccessExpressionOrQualifiedName`
            ExprKind::Dot { obj, name, .. } => {
                let object = self.type_of_expr(file, obj);
                if !is_definite {
                    let object = self.non_nullable(object);
                    let object = if is_widened {
                        self.regular_object(object)
                    } else {
                        object
                    };
                    return self
                        .type_of_property(object, name)
                        .unwrap_or(TypeId::UNRESOLVED);
                }
                let object = self.non_null_type(object);
                let object = self.regular_object(object);
                if self.is_assignment_to_readonly_property(file, target, obj, name) {
                    return TypeId::UNRESOLVED;
                }
                // `isThisPropertyAccessInConstructor`: a definite assignment target keeps `autoType`.
                if self
                    .auto_this_property(file, target, object, name)
                    .is_some()
                {
                    return TypeId::ANY;
                }
                // Through what a type parameter extends no index signature is written to.
                if self.is_generic_object_type(object)
                    && !matches!(self.data(object), TypeData::ThisParam(_))
                    && !self.finds_property(object, name)
                {
                    return TypeId::UNRESOLVED;
                }
                // What is only written to is what its setter takes. Either way an index signature takes what it says.
                let found = if is_write_only {
                    self.write_type_of_property(object, name)
                } else {
                    self.type_of_property_for_write(object, name)
                };
                match found {
                    // `getFlowTypeOfAccessExpression`: `removeMissingType`. Only what may be left out has it.
                    Some(ty) => self.remove_missing_type(ty, true),
                    None => TypeId::UNRESOLVED,
                }
            }
            // `checkElementAccessExpression`
            ExprKind::Index { obj, index, .. } => {
                let (object, key) = (self.type_of_expr(file, obj), self.type_of_expr(file, index));
                // `isForInVariableForNumericPropertyNames`: the key is `number`.
                let key = if self.is_for_in_variable_for_numeric_names(file, index) {
                    TypeId::NUMBER
                } else {
                    key
                };
                if !is_definite {
                    let object = if is_widened {
                        self.regular_object(object)
                    } else {
                        object
                    };
                    return self.indexed_access(object, key);
                }
                let object = self.non_null_type(object);
                let object = self.regular_object(object);
                if !self.is_known(object) || !self.is_known(key) {
                    return TypeId::UNRESOLVED;
                }
                // `shouldDeferIndexedAccessType`: in an expression it is the key that puts the answer off, or a tuple with a `...T` in
                // it that is asked for more than it has whatever `T` is.
                if self.is_generic(key) {
                    return self.indexed_access(object, key);
                }
                if self.is_tuple(object) && self.is_generic(object) {
                    let waiting = self.indexed_access(object, key);
                    if matches!(self.data(waiting), TypeData::IndexedAccess { .. }) {
                        return waiting;
                    }
                }
                for &k in self.parts(key) {
                    if let Some(name) = self.property_name_of_type(k)
                        && self.is_assignment_to_readonly_property(file, target, obj, name)
                    {
                        return TypeId::UNRESOLVED;
                    }
                }
                // `getPropertyTypeForIndexType`: `isThisPropertyAccessInConstructor` makes the property `autoType`.
                if hir.is_js
                    && let Some(name) = self.property_name_of_type(key)
                    && self
                        .auto_this_property(file, target, object, name)
                        .is_some()
                {
                    return TypeId::ANY;
                }
                // `AccessFlagsWriting`, and `AccessFlagsNoIndexSignatures` for what waits for type parameters, `this` aside.
                let no_index_signatures = self.is_generic_object_type(object)
                    && !matches!(self.data(object), TypeData::ThisParam(_));
                match self.indexed_access_for_writing(object, key, no_index_signatures) {
                    Some(ty) => {
                        let ty = self.force(ty);
                        self.remove_missing_type(ty, true)
                    }
                    None => TypeId::UNRESOLVED,
                }
            }
            _ => TypeId::UNRESOLVED,
        }
    }

    /// `isAssignmentToReadonlyEntity`, of the property `name` of `obj`, which `target` writes to.
    pub(super) fn is_assignment_to_readonly_property(
        &mut self,
        file: FileId,
        target: ExprId,
        obj: ExprId,
        name: Atom,
    ) -> bool {
        let mut said = Vec::new();
        self.check_property_write(file, target, obj, name, 0, &mut said);
        !said.is_empty()
    }

    /// Whether `getPropertyOfType` finds `name` in what `ty` is seen as: what an index signature stands in for is not found.
    pub(super) fn finds_property(&mut self, ty: TypeId, name: Atom) -> bool {
        let apparent = self.apparent_type(ty);
        self.parts(apparent).iter().all(|&part| {
            let part = self.apparent_type(part);
            match self.members(part) {
                Some(members) => self.property_in(&members, name).is_some(),
                None => false,
            }
        })
    }

    /// `getTypePredicateFromBody`: `x => x.kind === "a"` is a type guard though it does not say so.
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
        // The one thing that is returned, and where control is by then. `NONE`: where the function starts.
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
                // `checkIfExpressionRefinesParameter`: where control is at the `return` goes for what is written right in it. A test
                // in parentheses is taken as if nothing came before it.
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
        // What cannot narrow anything is not worth asking about.
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
        // What is tested on the way may call the function itself. To `getTypePredicateOfSignature` it has no predicate while one is
        // being looked for; here the looking stops once it has gone round often enough.
        if self.flow_depth > 12 {
            return None;
        }
        // `functionHasImplicitReturn`
        if info.end.is_some() && info.end != UNREACHABLE {
            let crosses_functions =
                std::mem::replace(&mut self.reachability_crosses_functions, false);
            let past = std::mem::replace(&mut self.reachability_past_exhaustive_switches, false);
            let falls_off_the_end = self.is_reachable(file, info.end);
            self.reachability_crosses_functions = crosses_functions;
            self.reachability_past_exhaustive_switches = past;
            if falls_off_the_end {
                return None;
            }
        }
        let returned = self.type_of_expr(file, body);
        if returned != TypeId::BOOLEAN {
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
            // `x is true` is of no use to anybody.
            if !self.is_known(declared) || declared == TypeId::BOOLEAN {
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
            self.flow_depth += 1;
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
            self.flow_depth -= 1;
            self.walk_declared = outer;
            // `x is never` is a type guard like any other, unless that nothing is left rests on something unknown.
            if when_true == declared
                || leftover != TypeId::NEVER
                || when_true == TypeId::NEVER && self.uncertain
            {
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

    /// `getFlowTypeOfReference` of a parameter declared as `declared` that is `initial` where its function starts, past the test
    /// `test`, which is made at `before` (`NONE`: where the function starts) and comes out as `sense`.
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
        } else if before == UNREACHABLE {
            // `getTypeAtFlowNode`: of what control does not get to, the declared type is said.
            declared
        } else {
            let mut walk = Walk::new(reference.clone(), declared, initial, Auto::No, false);
            let ty = self.flow_type(&mut walk, before);
            // Nothing is known of what comes after a call that never returns.
            if ty == TypeId::NEVER && !self.is_reachable_by_walk(&walk, before) {
                return declared;
            }
            if walk.steps >= MAX_STEPS {
                declared
            } else {
                ty
            }
        };
        // `getTypeAtFlowCondition`
        if start == TypeId::NEVER {
            start
        } else {
            self.narrow(reference, start, test, sense)
        }
    }
}
