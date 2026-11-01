use super::answers::{CheckedType, GaveUp, MemberLookup};
use super::builtin_types::BuiltinClassIndex;
use super::prototype_links::{NamedValue, PrototypeOperation};
use super::queries::Queries;
use crate::atom::{Atom, known};
use crate::bind::{Binding, Bound, Decl, FnOwner, Parent, PatParent, StoreKind, SymbolId};
use crate::check::root_declaration;
use crate::hir::{
    self, BinOp, CallId, Chain, ExprFlags, ExprId, ExprKind, ExprTag, Flags, FnBody, FnId, FnKind,
    MemberKey, ParamId, PatId, PatKind, PropId, PropKey, PropKind, StmtId, StmtKind, UnOp, VarKind,
};
use crate::program::{FileId, FileRole};
use crate::session::vec_from_iter_in;
use crate::types::{
    MapperId, Prop, PropFlags, PropSource, Shape, SigId, SigParam, TypeData, TypeId,
};
use crate::util::FxHashMap;
use smallvec::SmallVec;
use std::rc::Rc;

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub(super) enum Subject {
    Binding(SymbolId),
    Pattern(PatId),
    This(FnId),
    Result(FnId),
    Expression(ExprId),
    Number(SymbolId),
}

pub(super) enum UsageState {
    /// `assumed`: what it answers with when it is run into.
    InProgress {
        index: usize,
        assumed: Option<Rc<Usage>>,
    },
    /// It is walked, and leads back to a subject that is in progress.
    InCycle {
        index: usize,
        found: Rc<Usage>,
    },
    /// What the round before found. This round has not come to it.
    Assumed(Rc<Usage>),
    Known(Rc<Usage>),
    /// It was walked, and rested on an answer of the checker that may be another next time.
    NotKept,
}

#[derive(Copy, Clone)]
pub(super) enum TypeState {
    /// The search for cycles has come to it and does not know yet what it leads back to. `index`: in the order of the search.
    Searched {
        index: u32,
    },
    /// It has not been computed, and is in no cycle.
    Alone,
    /// It has not been computed. `cycle`: in `TypesInProgress::cycles`.
    Member {
        cycle: u32,
    },
    /// `assumed`: what it answers with when it is run into. `None`: nothing, and whoever asked leads back to it.
    InProgress {
        depth: u32,
        assumed: Option<TypeId>,
    },
    /// It is computed, and leads back to a subject that is in progress. `position`: in `TypesInProgress::in_cycles`.
    InCycle {
        found: TypeId,
        position: u32,
    },
    /// What the first round found. The second has not come to it.
    Assumed(TypeId),
    Known(TypeId),
    /// It was computed, and rested on an answer of the checker that may be another next time.
    NotKept,
}

type Subjects = SmallVec<[Subject; 4]>;

struct SubjectSearched {
    subject: Subject,
    index: u32,
    /// The least index of an open subject that it leads to, its own at first.
    lowest_index: u32,
    asks_for: Subjects,
    next: usize,
}

impl TypeState {
    fn was_computed(self) -> bool {
        !matches!(
            self,
            TypeState::Searched { .. } | TypeState::Alone | TypeState::Member { .. }
        )
    }
}

#[derive(Default)]
struct SubjectStack {
    depth: usize,
    outermost_revisited: Option<usize>,
}

struct EnteredSubject {
    depth: usize,
    revisited_earlier: Option<usize>,
}

impl SubjectStack {
    fn enter(&mut self) -> EnteredSubject {
        let entered = EnteredSubject {
            depth: self.depth,
            revisited_earlier: self.outermost_revisited.take(),
        };
        self.depth += 1;
        entered
    }

    fn revisit(&mut self, depth: usize) {
        let outermost = self
            .outermost_revisited
            .map_or(depth, |other| other.min(depth));
        self.outermost_revisited = Some(outermost);
    }

    #[allow(clippy::needless_pass_by_value)] // what `enter` gave is used up
    fn leave(&mut self, entered: EnteredSubject) -> bool {
        self.depth = entered.depth;
        let outer = self
            .outermost_revisited
            .filter(|&depth| depth < entered.depth);
        self.outermost_revisited = entered.revisited_earlier;
        if let Some(depth) = outer {
            self.revisit(depth);
        }
        outer.is_some()
    }
}

#[derive(Default)]
pub(super) struct TypesInProgress {
    /// Depth 0 is the question. What the allowance does not reach leads back to it.
    subjects: SubjectStack,
    remaining_types: u64,
    /// The subjects that were left as `InCycle`, in that order.
    in_cycles: Vec<Subject>,
    /// By depth: how long `in_cycles` was when the subject was entered.
    first_in_cycle: Vec<usize>,
    /// The subjects that the allowance did not reach and that have never been computed.
    out_of_reach: Vec<Subject>,
    /// What led out of reach is being computed again. What that does not reach says nothing, and nobody waits for it.
    is_computing_again: bool,
    subjects_not_kept: u64,
    next_usage_index: usize,
    /// The subjects of each cycle, the least first. `None`: they have been asked for.
    cycles: Vec<Option<Box<[Subject]>>>,
}

impl TypesInProgress {
    fn enter(&mut self) -> EnteredSubject {
        self.first_in_cycle.push(self.in_cycles.len());
        self.subjects.enter()
    }

    fn leave(&mut self, entered: EnteredSubject) -> bool {
        self.first_in_cycle.pop();
        self.subjects.leave(entered)
    }

    /// Whoever asks a subject that was left as `InCycle` leads back to the innermost subject in progress that it was computed under.
    fn revisit_in_cycle(&mut self, position: u32) {
        let entered_earlier = self
            .first_in_cycle
            .partition_point(|&first| first <= position as usize);
        self.subjects.revisit(entered_earlier.saturating_sub(1));
    }
}

#[derive(Copy, Clone)]
pub(super) struct ReferenceIndex<'c> {
    to_bindings: &'c [(SymbolId, ExprId)],
    to_this: &'c [(FnId, ExprId)],
}

fn references_to<K: Copy + Ord>(references: &[(K, ExprId)], subject: K) -> &[(K, ExprId)] {
    let start = references.partition_point(|reference| reference.0 < subject);
    let len = references[start..].partition_point(|reference| reference.0 == subject);
    &references[start..start + len]
}

bitflags::bitflags! {
    #[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
    struct Facts: u16 {
        const NUMBER = 1 << 0;
        const INT32 = 1 << 1;
        const KEY = 1 << 2;
        const STRING = 1 << 3;
        const FUNCTION = 1 << 4;
        const OBJECT = 1 << 5;
        const STORED = 1 << 6;
        const REQUIRED = 1 << 7;
        const INCOMPLETE = 1 << 8;
        const NUMBER_AT_EVERY_VALUE = 1 << 9 | Self::NUMBER.bits();
        /// An object literal is stored: the value is neither an array nor a string.
        const OBJECT_LITERAL_STORED = 1 << 10;
    }
}

fn required_if(is_required: bool) -> Facts {
    match is_required {
        true => Facts::REQUIRED,
        false => Facts::empty(),
    }
}

#[derive(Clone, PartialEq, Eq)]
struct Member {
    name: Atom,
    usage: Rc<Usage>,
}

impl Member {
    fn is_called(&self) -> bool {
        self.usage.facts.contains(Facts::FUNCTION)
    }
}

/// A merge into a part that says nothing yet shares the other tree's part, so a part may belong to many trees: it is copied when one of them changes it.
#[derive(Default, Clone, PartialEq, Eq)]
pub(super) struct Usage {
    facts: Facts,
    arms: SmallVec<[TypeId; 2]>,
    members: Vec<Member>,
    elements: Option<Rc<Usage>>,
}

impl Usage {
    fn member_mut(&mut self, name: Atom) -> &mut Usage {
        let found = self.members.iter().position(|member| member.name == name);
        let index = found.unwrap_or_else(|| {
            self.members.push(Member {
                name,
                usage: Rc::default(),
            });
            self.members.len() - 1
        });
        Rc::make_mut(&mut self.members[index].usage)
    }

    fn elements_mut(&mut self) -> &mut Usage {
        Rc::make_mut(self.elements.get_or_insert_default())
    }

    /// `None`: more than `most`.
    fn count_nodes(&self, most: u64) -> Option<u64> {
        let mut count = 1;
        let parts = self.members.iter().map(|member| &member.usage);
        for part in parts.chain(&self.elements) {
            count += part.count_nodes(most.checked_sub(count)?)?;
        }
        (count <= most).then_some(count)
    }

    fn add_arm(&mut self, arm: TypeId) {
        if !self.arms.contains(&arm) {
            self.arms.push(arm);
        }
    }

    /// What the tree gets is paid for, not what it has: the subjects of a cycle merge what the others found, which is the same.
    fn merge(&mut self, walk: &mut Walk, other: &Usage) {
        if walk.is_out_of_budget() && !walk.looks_at_every_use_of(self) {
            return;
        }
        self.facts |= other.facts;
        for &arm in &other.arms {
            self.add_arm(arm);
        }
        if walk.is_out_of_budget() {
            return;
        }
        for member in &other.members {
            let own = self.members.iter().position(|own| own.name == member.name);
            match own {
                Some(own) => merge_part(&mut self.members[own].usage, walk, &member.usage),
                None if walk.enter_all_nodes_of(&member.usage) => self.members.push(member.clone()),
                None if walk.enter_node() => {
                    self.member_mut(member.name).merge(walk, &member.usage)
                }
                None => {}
            }
        }
        match (&mut self.elements, &other.elements) {
            (_, None) => {}
            (Some(own), Some(elements)) => merge_part(own, walk, elements),
            (None, Some(elements)) if walk.enter_all_nodes_of(elements) => {
                self.elements = Some(Rc::clone(elements));
            }
            (None, Some(elements)) => {
                if walk.enter_node() {
                    self.elements_mut().merge(walk, elements);
                }
            }
        }
    }

    fn is_incomplete(&self) -> bool {
        self.facts.contains(Facts::INCOMPLETE)
    }

    fn forget_parts(&mut self) {
        self.members.clear();
        self.elements = None;
    }

    fn is_number(&self) -> bool {
        self.facts.contains(Facts::NUMBER) || self.arms.contains(&TypeId::NUMBER)
    }

    fn has_stored_part(&self) -> bool {
        let is_stored = |part: &Usage| part.facts.contains(Facts::STORED);
        self.elements.as_deref().is_some_and(is_stored)
            || self.members.iter().any(|member| is_stored(&member.usage))
    }
}

/// `Usage::merge()` for a part. A part that many trees share is copied where the merge adds something to it, and not before. The merge finds that out itself, in its
/// one walk over the two trees: to compare them first, at every level again, takes the square of the height of a tree.
fn merge_part(own: &mut Rc<Usage>, walk: &mut Walk, other: &Rc<Usage>) {
    if Rc::ptr_eq(own, other) || (walk.is_out_of_budget() && !walk.looks_at_every_use_of(own)) {
        return;
    }
    if !own.facts.contains(other.facts) || other.arms.iter().any(|arm| !own.arms.contains(arm)) {
        let own = Rc::make_mut(own);
        own.facts |= other.facts;
        for &arm in &other.arms {
            own.add_arm(arm);
        }
    }
    if walk.is_out_of_budget() {
        return;
    }
    for member in &other.members {
        let found = own.members.iter().position(|own| own.name == member.name);
        match found {
            Some(found) => {
                let mut part = Rc::clone(&own.members[found].usage);
                merge_part(&mut part, walk, &member.usage);
                if !Rc::ptr_eq(&part, &own.members[found].usage) {
                    Rc::make_mut(own).members[found].usage = part;
                }
            }
            None if walk.enter_all_nodes_of(&member.usage) => {
                Rc::make_mut(own).members.push(member.clone());
            }
            None if walk.enter_node() => {
                let part = Rc::make_mut(own).member_mut(member.name);
                part.merge(walk, &member.usage);
            }
            None => {}
        }
    }
    match (&own.elements, &other.elements) {
        (_, None) => {}
        (Some(elements_of_own), Some(elements)) => {
            let mut part = Rc::clone(elements_of_own);
            merge_part(&mut part, walk, elements);
            if !Rc::ptr_eq(&part, elements_of_own) {
                Rc::make_mut(own).elements = Some(part);
            }
        }
        (None, Some(elements)) if walk.enter_all_nodes_of(elements) => {
            Rc::make_mut(own).elements = Some(Rc::clone(elements));
        }
        (None, Some(elements)) => {
            if walk.enter_node() {
                Rc::make_mut(own).elements_mut().merge(walk, elements);
            }
        }
    }
}

/// What a subject is used as is the least answer that holds for all subjects at once, whoever is asked for first:
/// - Each subject has the whole budget, for its own uses and for what its tree gets from others. The budget is for the
///   parts of the tree. Which of them a walk had found when it ended hangs on what the others had found by then, so a
///   tree that is not all there has no parts. What the subject itself is used as is a few facts and types: every use of
///   it is looked at, however many there are.
/// - In a cycle, a subject in progress that is run into answers with what the round before found, nothing in the first.
///   The subject that the cycle was entered by is walked again until no subject of the cycle finds anything new. A round
///   only adds to what the round before found, so the rounds end. Then all of them are kept: a cycle is walked once,
///   not once for each of its subjects.
/// - What goes into a part of a tree (`visit(node.left)`) counts only when it is kept, that is when it does not lead
///   back: a shape that holds itself would grow with every round.
/// - Nothing that rests on an answer of the checker that may be another next time is kept. What is thrown away has one
///   budget: see `shares_budget`.
/// - A chain of calls and a cycle of them are as long as they like: see `set_aside`.
struct Walk {
    max_nodes: u64,
    remaining_nodes: u64,
    /// The least index of a subject that the one being walked leads back to, its own at first.
    lowest_index: usize,
    /// The subjects that were left as `InCycle`, in that order, once for each round.
    in_cycles: Vec<Subject>,
    found_something_new: bool,
    /// The tree of the subject being walked.
    root: *const Usage,
    subjects_not_kept: u64,
    unstable_answers_at_start: u64,
    /// What is in progress will not be kept, so from here on all subjects together have what is left of one budget, and
    /// a cycle has one round.
    shares_budget: bool,
    /// How many subjects are being walked on the stack of the thread.
    subjects_on_stack: usize,
    /// A subject was asked for while half of the stack was in use. Until the stack is free nothing is walked.
    is_freeing_stack: bool,
    /// The subjects that were on the stack then, the outermost first. They stay in progress. Where the stack is free the
    /// innermost is walked again, with what it had found of where it leads: what it asked for before answers at once,
    /// and what it asked for last has the stack to itself. When it is done, the one that asked for it is walked again.
    set_aside: Vec<SubjectInProgress>,
    /// `Some`: no number is asked whether it is an integer. Each is listed here and taken for one.
    numbers_listed: Option<Subjects>,
}

struct SubjectInProgress {
    subject: Subject,
    is_outermost: bool,
    unstable_answers: u64,
    assumed: Option<Rc<Usage>>,
    index: usize,
    first_in_cycle: usize,
    first_in_round: usize,
    /// What the walk held for the subject when it was set aside.
    lowest_index: usize,
    found_something_new: bool,
    /// What the walk held for the subject that asked for it.
    outer_lowest: usize,
    outer_nodes: u64,
    outer_root: *const Usage,
    outer_found_something_new: bool,
}

impl Walk {
    fn new(max_nodes: u64) -> Walk {
        Walk {
            max_nodes,
            remaining_nodes: max_nodes,
            lowest_index: usize::MAX,
            in_cycles: Vec::new(),
            found_something_new: false,
            root: std::ptr::null(),
            subjects_not_kept: 0,
            unstable_answers_at_start: 0,
            shares_budget: false,
            subjects_on_stack: 0,
            is_freeing_stack: false,
            set_aside: Vec::new(),
            numbers_listed: None,
        }
    }

    fn enter_node(&mut self) -> bool {
        let has_budget = self.remaining_nodes > 0 && !self.is_freeing_stack;
        self.remaining_nodes = self.remaining_nodes.saturating_sub(1);
        has_budget
    }

    /// Pays for every node of the tree at once, as a merge into an empty tree pays for them one by one. `false`: the budget ends inside the tree, and nothing is paid.
    fn enter_all_nodes_of(&mut self, usage: &Usage) -> bool {
        let Some(count) = usage.count_nodes(self.remaining_nodes) else {
            return false;
        };
        self.remaining_nodes -= count;
        true
    }

    fn is_out_of_budget(&self) -> bool {
        self.remaining_nodes == 0
    }

    fn looks_at_every_use_of(&self, usage: &Usage) -> bool {
        std::ptr::eq(usage, self.root) && !self.shares_budget && !self.is_freeing_stack
    }

    fn enter_node_of(&mut self, usage: &Usage) -> bool {
        self.enter_node() || self.looks_at_every_use_of(usage)
    }
}

#[derive(Copy, Clone)]
enum Use {
    Nothing,
    PassedOn(ExprId),
    Initializes(PatId),
    Destructured(ExprId),
    Member {
        access: ExprId,
        name: Atom,
        is_optional: bool,
    },
    Keyed {
        access: ExprId,
        key: ExprId,
        is_optional: bool,
    },
    Key {
        object: ExprId,
    },
    Called {
        is_optional: bool,
    },
    Argument {
        call: ExprId,
        index: usize,
    },
    Iterated(Option<PatId>),
    Object {
        is_required: bool,
    },
    Number,
    Int32,
    Updated,
    AddedTo(ExprId),
    ComparedWith(ExprId),
    Stored {
        op: Option<BinOp>,
        value: ExprId,
    },
}

fn find_use(hir: &hir::File<'_>, bound: &Bound<'_>, value: ExprId) -> Use {
    match bound.parent_of_expr(value) {
        Parent::Expr(parent) => match parent.some() {
            Some(parent) => find_use_in_expression(hir, bound, parent, value),
            None => Use::Nothing,
        },
        Parent::Stmt(statement) => match statement.some() {
            Some(statement) => find_use_in_statement(hir, statement),
            None => Use::Nothing,
        },
        Parent::VarInit(declaration) => Use::Initializes(hir[declaration].pat),
        Parent::Prop(property) => find_use_in_property(hir, bound, property, value),
        Parent::None
        | Parent::File
        | Parent::ParamDefault(_)
        | Parent::PatPropDefault(_)
        | Parent::PatElemDefault(_)
        | Parent::PropKey(_)
        | Parent::PatKey(_)
        | Parent::MemberKey(_)
        | Parent::MethodKey(_)
        | Parent::MemberInit(_)
        | Parent::FnBody(_)
        | Parent::EnumInit(_)
        | Parent::Case(_)
        | Parent::ClassExtends(_)
        | Parent::ClassDecorator(_)
        | Parent::MemberDecorator(_)
        | Parent::ParamDecorator(_)
        | Parent::Module(_) => Use::Nothing,
    }
}

fn find_use_in_expression(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    parent: ExprId,
    value: ExprId,
) -> Use {
    match hir[parent].kind {
        ExprKind::Dot { .. } | ExprKind::Index { .. } => find_use_in_access(hir, parent, value),
        ExprKind::Call(site) | ExprKind::New(site) => find_use_in_call(hir, parent, site, value),
        ExprKind::TaggedTemplate(site) if hir[site].callee == value => {
            Use::Called { is_optional: false }
        }
        ExprKind::Spread(_) if bound.get_assignment_target(hir, value).is_none() => {
            Use::Iterated(None)
        }
        ExprKind::Unary { op, .. } => find_use_as_unary_operand(op),
        ExprKind::Binary { op, left, right } => match left == value {
            true => find_use_as_binary_operand(op, parent, Side::Left, right),
            false => find_use_as_binary_operand(op, parent, Side::Right, left),
        },
        ExprKind::Assign {
            op,
            target,
            value: stored,
        } if target == value => Use::Stored { op, value: stored },
        ExprKind::Assign {
            op: None, target, ..
        } if matches!(hir[target].kind, ExprKind::Array(_)) => Use::Iterated(None),
        ExprKind::Assign {
            op: None, target, ..
        } if matches!(hir[target].kind, ExprKind::Object(_)) => Use::Destructured(target),
        ExprKind::Cond { test, .. } if test != value => Use::PassedOn(parent),
        ExprKind::As { .. }
        | ExprKind::Satisfies { .. }
        | ExprKind::AsConst(_)
        | ExprKind::NonNull(_)
        | ExprKind::Instantiation { .. } => Use::PassedOn(parent),
        ExprKind::TaggedTemplate(_)
        | ExprKind::Spread(_)
        | ExprKind::Assign { .. }
        | ExprKind::Cond { .. }
        | ExprKind::Missing
        | ExprKind::Ident(_)
        | ExprKind::PrivateIdentifier(_)
        | ExprKind::This
        | ExprKind::Super
        | ExprKind::Null
        | ExprKind::True
        | ExprKind::False
        | ExprKind::Number(_)
        | ExprKind::String(_)
        | ExprKind::BigInt(_)
        | ExprKind::Regex { .. }
        | ExprKind::Template { .. }
        | ExprKind::Array(_)
        | ExprKind::Object(_)
        | ExprKind::Fn(_)
        | ExprKind::Class(_)
        | ExprKind::Await(_)
        | ExprKind::Yield { .. }
        | ExprKind::Jsx(_)
        | ExprKind::ImportCall { .. }
        | ExprKind::ImportMeta
        | ExprKind::NewTarget(_)
        | ExprKind::JsxText(_) => Use::Nothing,
    }
}

fn find_use_in_access(hir: &hir::File<'_>, access: ExprId, value: ExprId) -> Use {
    let Some((object, key)) = hir.member_key(access) else {
        return Use::Nothing;
    };
    if object != value {
        return Use::Key { object };
    }
    let is_optional = hir
        .expr_flags(access)
        .contains(ExprFlags::OPTIONAL_CHAIN_LINK);
    match key {
        MemberKey::Name(name) => Use::Member {
            access,
            name,
            is_optional,
        },
        MemberKey::PrivateName(_) => Use::Object {
            is_required: !is_optional,
        },
        MemberKey::Computed(key) => Use::Keyed {
            access,
            key,
            is_optional,
        },
    }
}

fn find_use_in_call(hir: &hir::File<'_>, call: ExprId, site: CallId, value: ExprId) -> Use {
    let node = hir[site];
    if node.callee == value {
        return Use::Called {
            is_optional: node.chain == Chain::Start,
        };
    }
    for (index, argument) in hir.ids(node.args).enumerate() {
        if argument == value {
            return Use::Argument { call, index };
        }
        if matches!(hir[argument].kind, ExprKind::Spread(_)) {
            break;
        }
    }
    Use::Nothing
}

fn find_use_as_unary_operand(op: UnOp) -> Use {
    match op {
        UnOp::Plus | UnOp::Minus => Use::Number,
        UnOp::BitNot => Use::Int32,
        UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec => Use::Updated,
        UnOp::Not | UnOp::Typeof | UnOp::Void | UnOp::Delete => Use::Nothing,
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Side {
    Left,
    Right,
}

fn find_use_as_binary_operand(op: BinOp, whole: ExprId, side: Side, other: ExprId) -> Use {
    match op {
        BinOp::Add => Use::AddedTo(other),
        BinOp::Sub | BinOp::Mul | BinOp::Div | BinOp::Rem | BinOp::Pow => Use::Number,
        BinOp::Shl | BinOp::Shr | BinOp::UShr | BinOp::BitAnd | BinOp::BitOr | BinOp::BitXor => {
            Use::Int32
        }
        BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge => Use::ComparedWith(other),
        BinOp::And | BinOp::Or | BinOp::Nullish => Use::PassedOn(whole),
        BinOp::Comma if side == Side::Right => Use::PassedOn(whole),
        BinOp::In if side == Side::Right => Use::Object { is_required: true },
        BinOp::Comma
        | BinOp::In
        | BinOp::EqEq
        | BinOp::NotEq
        | BinOp::EqEqEq
        | BinOp::NotEqEq
        | BinOp::Instanceof => Use::Nothing,
    }
}

fn find_use_in_property(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    property: PropId,
    value: ExprId,
) -> Use {
    match hir[property].kind {
        PropKind::Spread if bound.get_assignment_target(hir, value).is_none() => {
            Use::Object { is_required: false }
        }
        PropKind::Spread
        | PropKind::Init
        | PropKind::Shorthand
        | PropKind::Method
        | PropKind::Getter
        | PropKind::Setter => Use::Nothing,
    }
}

fn find_use_in_statement(hir: &hir::File<'_>, statement: StmtId) -> Use {
    match hir[statement].kind {
        StmtKind::ForOf {
            left,
            is_await: false,
            ..
        } => Use::Iterated(find_declared_pattern(hir, left)),
        StmtKind::ForIn { .. } => Use::Object { is_required: false },
        StmtKind::ForOf { is_await: true, .. }
        | StmtKind::Empty
        | StmtKind::Debugger
        | StmtKind::Expr(_)
        | StmtKind::Var(_)
        | StmtKind::Fn(_)
        | StmtKind::Class(_)
        | StmtKind::Interface(_)
        | StmtKind::TypeAlias(_)
        | StmtKind::Enum(_)
        | StmtKind::Module(_)
        | StmtKind::Return(_)
        | StmtKind::If { .. }
        | StmtKind::For { .. }
        | StmtKind::While { .. }
        | StmtKind::DoWhile { .. }
        | StmtKind::Block(_)
        | StmtKind::Switch { .. }
        | StmtKind::Try { .. }
        | StmtKind::Throw(_)
        | StmtKind::Break(_)
        | StmtKind::Continue(_)
        | StmtKind::Labeled { .. }
        | StmtKind::Import(_)
        | StmtKind::ImportEquals(_)
        | StmtKind::ExportNamed(_)
        | StmtKind::ExportStar { .. }
        | StmtKind::ExportDefault(_)
        | StmtKind::ExportAssign(_)
        | StmtKind::ExportAsNamespace(_)
        | StmtKind::With { .. }
        | StmtKind::Directive { .. } => Use::Nothing,
    }
}

fn find_declared_pattern(hir: &hir::File<'_>, loop_head: StmtId) -> Option<PatId> {
    let StmtKind::Var(declarations) = hir[loop_head].kind else {
        return None;
    };
    let declaration = declarations.iter().next()?;
    Some(hir[declaration].pat)
}

fn find_initialized_symbol(bound: &Bound<'_>, name: PatId) -> Option<SymbolId> {
    match bound.initialized_binding(name) {
        Binding::Symbol(symbol) => Some(symbol),
        Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => None,
    }
}

fn has_written_type(hir: &hir::File<'_>, bound: &Bound<'_>, name: PatId) -> bool {
    root_declaration(bound, name).has_type_annotation(hir)
}

fn is_untyped_variable(hir: &hir::File<'_>, bound: &Bound<'_>, symbol: SymbolId) -> bool {
    let declarations = bound.symbol(symbol).decls;
    !declarations.is_empty()
        && declarations.iter().all(|&declaration| match declaration {
            Decl::Var(name) | Decl::Param(name) => !has_written_type(hir, bound, name),
            Decl::Fn(_)
            | Decl::Class(_)
            | Decl::Interface(_)
            | Decl::Alias(_)
            | Decl::Enum(_)
            | Decl::EnumMember(_)
            | Decl::Module(_)
            | Decl::TypeParam(_)
            | Decl::ImportDefault(_)
            | Decl::ImportNamespace(_)
            | Decl::ImportSpec(_)
            | Decl::ImportEquals(_)
            | Decl::ExportSpec(_)
            | Decl::ExportStarAs(_)
            | Decl::ExportExpr(_)
            | Decl::UmdGlobal(_)
            | Decl::File
            | Decl::Require(_)
            | Decl::ModuleExports(_)
            | Decl::ExportsProperty(_)
            | Decl::Expando(_)
            | Decl::ObjectLiteral(_)
            | Decl::CommonJsVariable
            | Decl::Member(_)
            | Decl::ParameterProperty(_)
            | Decl::ThisProperty(_)
            | Decl::Property(_)
            | Decl::TypeLiteral(_) => false,
        })
}

fn find_alternatives(hir: &hir::File<'_>, expression: ExprId) -> SmallVec<[ExprId; 2]> {
    let mut alternatives = SmallVec::new();
    if let ExprKind::Cond { branches, .. } = hir[expression].kind {
        let branches = hir.branches(branches);
        alternatives.extend([branches.yes, branches.no]);
    } else if let ExprKind::Binary { op, left, right } = hir[expression].kind {
        for (side, operand, other) in [(Side::Left, left, right), (Side::Right, right, left)] {
            if let Use::PassedOn(_) = find_use_as_binary_operand(op, expression, side, other) {
                alternatives.push(operand);
            }
        }
    }
    alternatives
}

fn is_evaluated_for_some_values_only(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    expression: ExprId,
) -> bool {
    let mut inner = expression;
    while let Parent::Expr(parent) = bound.parent_of_expr(inner) {
        let Some(parent) = parent.some() else {
            return false;
        };
        match hir[parent].kind {
            ExprKind::Binary {
                op: BinOp::And | BinOp::Or | BinOp::Nullish,
                right,
                ..
            } if right == inner => return true,
            ExprKind::Cond { test, .. } if test != inner => return true,
            _ => inner = parent,
        }
    }
    false
}

fn is_int32_value(value: f64) -> bool {
    let is_negative_zero = value == 0.0 && value.is_sign_negative();
    value.fract() == 0.0
        && value >= f64::from(i32::MIN)
        && value <= f64::from(i32::MAX)
        && !is_negative_zero
}

fn yields_int32(op: BinOp) -> bool {
    match op {
        BinOp::Shl | BinOp::Shr | BinOp::BitAnd | BinOp::BitOr | BinOp::BitXor => true,
        BinOp::UShr
        | BinOp::Add
        | BinOp::Sub
        | BinOp::Mul
        | BinOp::Div
        | BinOp::Rem
        | BinOp::Pow
        | BinOp::Lt
        | BinOp::Le
        | BinOp::Gt
        | BinOp::Ge
        | BinOp::EqEq
        | BinOp::NotEq
        | BinOp::EqEqEq
        | BinOp::NotEqEq
        | BinOp::And
        | BinOp::Or
        | BinOp::Nullish
        | BinOp::In
        | BinOp::Instanceof
        | BinOp::Comma => false,
    }
}

fn is_int32_literal(hir: &hir::File<'_>, value: ExprId) -> bool {
    let ExprKind::Number(index) = hir[value].kind else {
        return false;
    };
    let number = hir.numbers[index as usize];
    number == f64::from(number as i32)
}

const MAX_TERMS_READ: usize = 16;

fn is_sum_with_product(hir: &hir::File<'_>, value: ExprId) -> bool {
    let mut terms = vec![value];
    for _ in 0..MAX_TERMS_READ {
        let Some(term) = terms.pop() else {
            return false;
        };
        match hir[term].kind {
            ExprKind::Binary {
                op: BinOp::Mul | BinOp::Div | BinOp::Pow,
                ..
            } => return true,
            ExprKind::Binary {
                op: BinOp::Add | BinOp::Sub,
                left,
                right,
            } => terms.extend([left, right]),
            _ => {}
        }
    }
    false
}

/// `var v = x * digit + carry; low = v & mask`: a bit operation takes any number, and cuts one that has left the range.
fn is_given_product(hir: &hir::File<'_>, bound: &Bound<'_>, reference: ExprId) -> bool {
    let ExprKind::Ident(_) = hir[reference].kind else {
        return false;
    };
    let Binding::Symbol(symbol) = bound.binding(reference) else {
        return false;
    };
    let starts_as_product = bound.symbol(symbol).decls.iter().any(|&declaration| {
        let Decl::Var(name) = declaration else {
            return false;
        };
        let PatParent::Var(variable) = bound.pat_parent[name.idx()] else {
            return false;
        };
        let initializer = hir[variable].init.some();
        initializer.is_some_and(|initializer| is_sum_with_product(hir, initializer))
    });
    starts_as_product
        || bound.stores_to(symbol).iter().any(|store| {
            let Use::Stored { op, value } = find_use(hir, bound, store.target) else {
                return false;
            };
            match op {
                None => is_sum_with_product(hir, value),
                Some(op) => matches!(op, BinOp::Mul | BinOp::Div | BinOp::Pow),
            }
        })
}

fn find_enclosing_sum(hir: &hir::File<'_>, bound: &Bound<'_>, operand: ExprId) -> Option<ExprId> {
    let Parent::Expr(parent) = bound.parent_of_expr(operand) else {
        return None;
    };
    let parent = parent.some()?;
    let is_sum = matches!(
        hir[parent].kind,
        ExprKind::Binary {
            op: BinOp::Add | BinOp::Sub,
            ..
        }
    );
    is_sum.then_some(parent)
}

// `answers`: those for the sums that earlier questions went through. In `a + b + c + ..` each name stands one sum further out, so
// without them the names of one long sum would walk it once each.
fn is_used_as_int32(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    number: ExprId,
    answers: &mut FxHashMap<ExprId, bool>,
) -> bool {
    let mut walked: SmallVec<[ExprId; 4]> = SmallVec::new();
    let mut value = number;
    let answer = loop {
        match find_use(hir, bound, value) {
            Use::Int32 | Use::Key { .. } => break true,
            Use::Stored { op: Some(op), .. } => break yields_int32(op) || op == BinOp::UShr,
            Use::AddedTo(_) | Use::Number => match find_enclosing_sum(hir, bound, value) {
                Some(sum) => match answers.get(&sum) {
                    Some(&known) => break known,
                    None => {
                        walked.push(sum);
                        value = sum;
                    }
                },
                None => break false,
            },
            Use::Nothing
            | Use::PassedOn(_)
            | Use::Initializes(_)
            | Use::Destructured(_)
            | Use::Member { .. }
            | Use::Keyed { .. }
            | Use::Called { .. }
            | Use::Argument { .. }
            | Use::Iterated(_)
            | Use::Object { .. }
            | Use::Updated
            | Use::ComparedWith(_)
            | Use::Stored { op: None, .. } => break false,
        }
    };
    answers.extend(walked.into_iter().map(|sum| (sum, answer)));
    answer
}

const MAX_CALLS_READ: usize = 16;

fn find_name_of_function(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    function: FnId,
) -> Option<SymbolId> {
    match bound.fns[function.idx()].owner {
        FnOwner::Stmt(_) => bound.fn_symbol[function.idx()].some(),
        FnOwner::Expr(expression) => match bound.parent_of_expr(expression) {
            Parent::VarInit(declaration) => find_initialized_symbol(bound, hir[declaration].pat),
            _ => None,
        },
        FnOwner::None | FnOwner::Member(_) | FnOwner::Type(_) => None,
    }
}

fn find_argument_of_call(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    first_spread_arguments: &mut FxHashMap<ExprId, u32>,
    callee: ExprId,
    index: usize,
) -> Option<ExprId> {
    let Parent::Expr(call) = bound.parent_of_expr(callee) else {
        return None;
    };
    let call = call.some()?;
    let ExprKind::Call(site) = hir[call].kind else {
        return None;
    };
    let node = hir[site];
    if node.callee != callee {
        return None;
    }
    let first_spread = *first_spread_arguments.entry(call).or_insert_with(|| {
        let mut arguments = hir.ids(node.args);
        let spread = arguments.position(|it| matches!(hir[it].kind, ExprKind::Spread(_)));
        spread.map_or(u32::MAX, |position| position as u32)
    });
    if first_spread as usize <= index {
        return None;
    }
    // `nth` would visit every argument in front of this one.
    match index < node.args.len() {
        true => Some(hir.id_at(node.args, index)),
        false => Some(ExprId::NONE),
    }
}

fn find_parameter(parameters: &[SigParam], index: usize) -> Option<SigParam> {
    parameters
        .get(index)
        .copied()
        .filter(|parameter| !parameter.rest)
}

#[derive(Copy, Clone)]
struct CallWithReceiver {
    signature: SigId,
    takes_argument_list: bool,
}

type TypeParts = SmallVec<[TypeId; 4]>;
type ReturnedExpressions = SmallVec<[(ExprId, TypeId); 4]>;

impl<'c, 'p, 's> Queries<'c, 'p, 's> {
    fn are_positions_only_expected(&self, of: FileId) -> bool {
        match self.role(of) {
            FileRole::Inferred => true,
            FileRole::Checked | FileRole::TypesOnly => false,
        }
    }

    pub(super) fn infer_parameter_type(
        &mut self,
        of: FileId,
        parameter: ParamId,
        checked: TypeId,
    ) -> TypeId {
        match self.find_parameter_subject(of, parameter, checked) {
            Some(subject) if self.are_positions_only_expected(of) => {
                self.inferred_argument_type_or(subject, checked)
            }
            Some(_) | None => checked,
        }
    }

    pub(super) fn infer_binding_type(&mut self, pattern: PatId, checked: TypeId) -> TypeId {
        let (hir, bound) = (self.hir(), self.bound());
        let is_untyped_name = matches!(hir[pattern].kind, PatKind::Ident(_))
            && !has_written_type(hir, bound, pattern)
            && self.are_positions_only_expected(self.file);
        let Some(symbol) = find_initialized_symbol(bound, pattern).filter(|_| is_untyped_name)
        else {
            return checked;
        };
        if checked == TypeId::NUMBER {
            return self.inferred_type_or(Subject::Number(symbol), checked);
        }
        if !self.c.is_any(checked) {
            return checked;
        }
        match bound.pat_parent[pattern.idx()] {
            PatParent::Param(_) => {
                self.inferred_argument_type_or(Subject::Binding(symbol), checked)
            }
            PatParent::None | PatParent::Var(_) | PatParent::Prop(..) | PatParent::Elem(..) => {
                self.inferred_type_or(Subject::Binding(symbol), checked)
            }
        }
    }

    /// Whether the name is one for instances of the built-in class: by its type, and where that is `any` or `unknown` by what is stored in it and by the members read from it.
    /// What is inferred depends on what was asked before. This asks none of it, so it may be asked at any time.
    pub fn is_binding_of_builtin(
        &mut self,
        pattern: PatId,
        class: BuiltinClassIndex,
    ) -> Result<bool, GaveUp> {
        let checked = self.ask(|queries| {
            let ty = queries.c.type_of_pat(queries.file, pattern);
            queries.resolved(ty)
        })?;
        if !self.c.is_any(checked) && checked != TypeId::UNKNOWN {
            return self.is_type_of_builtin(checked, class);
        }
        let (hir, bound) = (self.hir(), self.bound());
        let Some(symbol) = find_initialized_symbol(bound, pattern) else {
            return Ok(false);
        };
        let mut stored: SmallVec<[ExprId; 2]> = SmallVec::new();
        if let PatParent::Var(variable) = bound.pat_parent[pattern.idx()] {
            stored.extend(hir[variable].init.some());
        }
        for &(_, reference) in references_to(self.reference_index().to_bindings, symbol) {
            let mut value = reference;
            let found = loop {
                match find_use(hir, bound, value) {
                    Use::PassedOn(whole) => value = whole,
                    found => break found,
                }
            };
            match found {
                Use::Stored { op: None, value } => stored.push(value),
                Use::Member { name, .. } if self.is_member_of_builtin(name, class) => {
                    return Ok(true);
                }
                _ => {}
            }
        }
        for value in stored {
            let ty = self.expression_type(value)?;
            if self.is_type_of_builtin(ty, class)? {
                return Ok(true);
            }
        }
        Ok(false)
    }

    pub(super) fn infer_this_type(&mut self, of: FileId, function: FnId) -> TypeId {
        match self.find_this_subject(of, function) {
            Some(subject) => self.inferred_type(subject),
            None => TypeId::ANY,
        }
    }

    pub(super) fn infer_result_type(
        &mut self,
        of: FileId,
        function: FnId,
        checked: TypeId,
    ) -> TypeId {
        let is_untyped = self.c.is_any(checked) && self.are_positions_only_expected(of);
        match self.find_result_subject(of, function) {
            Some(subject) if is_untyped => self.inferred_type_or(subject, checked),
            Some(_) | None => checked,
        }
    }

    pub(super) fn infer_expression_type(&mut self, expression: ExprId, checked: TypeId) -> TypeId {
        match self.find_subject_of_expression(expression, checked) {
            Some(subject) => self.inferred_type_or(subject, checked),
            None => checked,
        }
    }

    fn find_subject_of_expression(&self, expression: ExprId, checked: TypeId) -> Option<Subject> {
        match self.c.is_any(checked) {
            true => Some(Subject::Expression(expression)),
            false => self.find_number_subject(expression, checked),
        }
    }

    fn inferred_argument_type_or(&mut self, subject: Subject, checked: TypeId) -> TypeId {
        match self.inferred_type_or(subject, checked) {
            TypeId::NUMBER => checked,
            inferred => inferred,
        }
    }

    fn inferred_type_or(&mut self, subject: Subject, checked: TypeId) -> TypeId {
        let inferred = self.inferred_type(subject);
        match self.c.is_any(inferred) {
            true => checked,
            false => inferred,
        }
    }

    fn find_parameter_subject(
        &self,
        of: FileId,
        parameter: ParamId,
        checked: TypeId,
    ) -> Option<Subject> {
        if of != self.file {
            return None;
        }
        let (hir, bound) = (self.hir(), self.bound());
        let node = hir[parameter];
        if node.ty.is_some() {
            return None;
        }
        match hir[node.pat].kind {
            PatKind::Ident(_) if self.c.is_any(checked) => {
                find_initialized_symbol(bound, node.pat).map(Subject::Binding)
            }
            PatKind::Object(_) if self.is_implied_by_pattern(checked, node.pat) => {
                Some(Subject::Pattern(node.pat))
            }
            PatKind::Ident(_) | PatKind::Object(_) | PatKind::Array(_) | PatKind::Missing => None,
        }
    }

    fn is_implied_by_pattern(&self, ty: TypeId, pattern: PatId) -> bool {
        let position = (self.file, self.hir()[pattern].pos);
        matches!(self.c.data(ty), TypeData::Synth(shape) if shape.pattern_at == Some(position))
    }

    fn find_this_subject(&self, of: FileId, function: FnId) -> Option<Subject> {
        if of != self.file {
            return None;
        }
        let node = self.hir()[function];
        let has_own_this = match node.kind {
            FnKind::Decl | FnKind::Expr | FnKind::Method | FnKind::Getter | FnKind::Setter => true,
            FnKind::Arrow
            | FnKind::Constructor
            | FnKind::StaticBlock
            | FnKind::CallSignature
            | FnKind::ConstructSignature
            | FnKind::FunctionType
            | FnKind::ConstructorType
            | FnKind::IndexSignature => false,
        };
        let is_untyped =
            node.this_param.is_none() && self.c.class_of_member_fn(of, function).is_none();
        (has_own_this && is_untyped).then_some(Subject::This(function))
    }

    fn find_result_subject(&self, of: FileId, function: FnId) -> Option<Subject> {
        if of != self.file {
            return None;
        }
        let node = self.hir()[function];
        let returns_a_value = match node.kind {
            FnKind::Decl | FnKind::Expr | FnKind::Arrow | FnKind::Method | FnKind::Getter => true,
            FnKind::Setter
            | FnKind::Constructor
            | FnKind::StaticBlock
            | FnKind::CallSignature
            | FnKind::ConstructSignature
            | FnKind::FunctionType
            | FnKind::ConstructorType
            | FnKind::IndexSignature => false,
        };
        let wraps_the_value = node.flags.intersects(Flags::ASYNC | Flags::GENERATOR);
        (returns_a_value && !wraps_the_value && node.ret.is_none())
            .then_some(Subject::Result(function))
    }

    fn find_result_subject_of_call(&mut self, call: ExprId) -> Option<Subject> {
        if !matches!(self.hir()[call].kind, ExprKind::Call(_)) {
            return None;
        }
        let declaration = self.resolved_call(call).ok()??.declaration?;
        self.find_result_subject(declaration.file, declaration.function)
    }

    fn find_referenced_subject(&self, expression: ExprId) -> Option<Subject> {
        let (hir, bound) = (self.hir(), self.bound());
        if matches!(hir[expression].kind, ExprKind::This) {
            return match self.c.this_container(self.file, expression) {
                Some(Ok(function)) => self.find_this_subject(self.file, function),
                Some(Err(_)) | None => None,
            };
        }
        if !matches!(hir[expression].kind, ExprKind::Ident(_)) {
            return None;
        }
        match bound.binding(expression) {
            Binding::Symbol(symbol) if is_untyped_variable(hir, bound, symbol) => {
                Some(Subject::Binding(symbol))
            }
            Binding::Symbol(_) | Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => {
                None
            }
        }
    }

    fn find_number_subject(&self, expression: ExprId, checked: TypeId) -> Option<Subject> {
        if checked != TypeId::NUMBER {
            return None;
        }
        match self.find_referenced_subject(expression) {
            Some(Subject::Binding(symbol)) => Some(Subject::Number(symbol)),
            Some(
                Subject::Pattern(_)
                | Subject::This(_)
                | Subject::Result(_)
                | Subject::Expression(_)
                | Subject::Number(_),
            )
            | None => None,
        }
    }

    /// - A walk may compute `max_inference_nodes` subjects. What it does not reach is walked next, with an allowance of
    ///   its own, and then what led there is computed again, the last walk first: a chain of calls is as long as it likes.
    /// - A cycle has two rounds. In the first a subject in progress says nothing, and the subject that the cycle was
    ///   entered by is kept. In the second the others are computed again, and one in progress says what the first round
    ///   found. Then all of them are kept: a cycle is computed twice, not once for each of its subjects.
    /// - Whichever subject of a cycle is asked for first, the cycle is entered by the least of them: see `take_cycle_of`.
    fn inferred_type(&mut self, subject: Subject) -> TypeId {
        if self.memo.types_in_progress.subjects.depth != 0 {
            return self.inferred_type_within_allowance(subject);
        }
        if let Some(&TypeState::Known(known)) = self.memo.inferred_types.get(&subject) {
            return known;
        }
        if self.inputs.max_inference_nodes == 0 {
            return TypeId::ANY;
        }
        let question = self.memo.types_in_progress.enter();
        let first_answer = self.inferred_type_with_new_allowance(subject);
        let in_progress = &self.memo.types_in_progress;
        if !in_progress.in_cycles.is_empty() || !in_progress.out_of_reach.is_empty() {
            self.infer_types_out_of_reach();
        }
        self.memo.types_in_progress.leave(question);
        match self.memo.inferred_types.get(&subject) {
            Some(&TypeState::Known(known)) => known,
            _ => first_answer,
        }
    }

    fn inferred_type_with_new_allowance(&mut self, subject: Subject) -> TypeId {
        self.memo.types_in_progress.remaining_types = self.inputs.max_inference_nodes;
        self.inferred_type_within_allowance(subject)
    }

    #[cold]
    fn infer_types_out_of_reach(&mut self) {
        loop {
            let mut walks: SmallVec<[usize; 4]> = SmallVec::new();
            walks.push(0);
            while let Some(next) = self.memo.types_in_progress.out_of_reach.pop() {
                let state = self.memo.inferred_types.get(&next);
                if !state.is_some_and(|state| state.was_computed()) {
                    walks.push(self.memo.types_in_progress.in_cycles.len());
                    self.inferred_type_with_new_allowance(next);
                }
            }
            let unsettled = std::mem::take(&mut self.memo.types_in_progress.in_cycles);
            if unsettled.is_empty() {
                return;
            }
            self.assume_types_found(&unsettled);
            self.memo.types_in_progress.is_computing_again = true;
            let mut end = unsettled.len();
            for &start in walks.iter().rev() {
                for &other in &unsettled[start..end] {
                    self.inferred_type_with_new_allowance(other);
                }
                end = start;
            }
            self.memo.types_in_progress.is_computing_again = false;
        }
    }

    fn assume_types_found(&mut self, in_cycle: &[Subject]) {
        for other in in_cycle {
            if let Some(state) = self.memo.inferred_types.get_mut(other)
                && let TypeState::InCycle { found, .. } = *state
            {
                *state = TypeState::Assumed(found);
            }
        }
    }

    fn infer_types_of_cycle_again(&mut self, first_in_cycle: usize) {
        let in_cycles = &mut self.memo.types_in_progress.in_cycles;
        let in_cycle: Vec<Subject> = in_cycles.drain(first_in_cycle..).collect();
        self.assume_types_found(&in_cycle);
        for &other in &in_cycle {
            self.inferred_type_within_allowance(other);
        }
        if self.memo.types_in_progress.remaining_types != 0 {
            return;
        }
        for &other in &in_cycle {
            if let Some(&TypeState::Assumed(found)) = self.memo.inferred_types.get(&other) {
                self.leave_type_in_cycle(other, found);
            }
        }
    }

    fn leave_type_in_cycle(&mut self, subject: Subject, found: TypeId) {
        let in_cycles = &mut self.memo.types_in_progress.in_cycles;
        let position = in_cycles.len() as u32;
        in_cycles.push(subject);
        let state = TypeState::InCycle { found, position };
        self.memo.inferred_types.insert(subject, state);
    }

    fn count_answers_not_kept(&self) -> u64 {
        self.count_unstable_answers() + self.memo.types_in_progress.subjects_not_kept
    }

    fn inferred_type_within_allowance(&mut self, subject: Subject) -> TypeId {
        if self.infers_nothing_from_use {
            return TypeId::ANY;
        }
        let in_progress = &mut self.memo.types_in_progress;
        let state = self.memo.inferred_types.get(&subject).copied();
        let assumed = match state {
            Some(TypeState::Known(known)) => return known,
            Some(TypeState::InProgress {
                depth,
                assumed: None,
            }) => {
                in_progress.subjects.revisit(depth as usize);
                return TypeId::ANY;
            }
            Some(TypeState::InProgress {
                assumed: Some(assumed),
                ..
            }) => return assumed,
            Some(TypeState::InCycle { found, position }) => {
                in_progress.revisit_in_cycle(position);
                return found;
            }
            Some(TypeState::Assumed(found)) => Some(found),
            Some(
                TypeState::NotKept
                | TypeState::Searched { .. }
                | TypeState::Alone
                | TypeState::Member { .. },
            )
            | None => None,
        };
        let was_computed = state.is_some_and(TypeState::was_computed);
        if in_progress.remaining_types == 0 {
            if let Some(found) = assumed {
                return found;
            }
            match was_computed {
                false => {
                    if !in_progress.is_computing_again {
                        in_progress.subjects.revisit(0);
                    }
                    in_progress.out_of_reach.push(subject);
                }
                true => in_progress.subjects_not_kept += 1,
            }
            return TypeId::ANY;
        }
        let may_be_in_cycle = !was_computed && !matches!(state, Some(TypeState::Alone));
        if may_be_in_cycle && self.infer_types_of_cycle_around(subject) {
            return self.inferred_type_within_allowance(subject);
        }
        let in_progress = &mut self.memo.types_in_progress;
        in_progress.remaining_types -= 1;
        self.statistics.types_inferred += 1;
        let first_in_cycle = in_progress.in_cycles.len();
        let entered = in_progress.enter();
        let state = TypeState::InProgress {
            depth: entered.depth as u32,
            assumed,
        };
        self.memo.inferred_types.insert(subject, state);
        let answers_not_kept = self.count_answers_not_kept();
        let inferred = self.ask(|queries| {
            Ok(match subject {
                Subject::Expression(expression) => queries.compute_expression_type(expression),
                Subject::Result(function) => queries.compute_result_type(function),
                Subject::Number(symbol) => queries.compute_number_type(symbol),
                Subject::Binding(symbol) => queries.compute_binding_type(symbol),
                Subject::Pattern(_) | Subject::This(_) => queries.compute_type_from_uses(subject),
            })
        });
        let inferred = inferred.unwrap_or(TypeId::ANY);
        let leads_back = self.memo.types_in_progress.leave(entered);
        if self.count_answers_not_kept() != answers_not_kept {
            let in_cycles = &mut self.memo.types_in_progress.in_cycles;
            for other in in_cycles.drain(first_in_cycle..) {
                self.memo.inferred_types.insert(other, TypeState::NotKept);
            }
            self.memo.inferred_types.insert(subject, TypeState::NotKept);
        } else if leads_back {
            self.leave_type_in_cycle(subject, inferred);
        } else {
            let known = TypeState::Known(inferred);
            self.memo.inferred_types.insert(subject, known);
            let in_progress = &self.memo.types_in_progress;
            if in_progress.in_cycles.len() > first_in_cycle && in_progress.remaining_types != 0 {
                self.infer_types_of_cycle_again(first_in_cycle);
            }
        }
        inferred
    }

    /// `false`: it is in no cycle, or in one that has been entered.
    #[inline(never)]
    fn infer_types_of_cycle_around(&mut self, subject: Subject) -> bool {
        let Some(cycle) = self.take_cycle_of(subject) else {
            return false;
        };
        for &member in &cycle {
            self.inferred_type_within_allowance(member);
        }
        true
    }

    /// The cycle that nothing has been asked of yet and that the subject is in. What a subject of a cycle turns out as
    /// hangs on where the cycle is entered, so which subjects are in one is found before any of them is computed, from
    /// what each may ask for whatever the answers are.
    fn take_cycle_of(&mut self, subject: Subject) -> Option<Box<[Subject]>> {
        if matches!(subject, Subject::Pattern(_) | Subject::This(_)) {
            return None;
        }
        let mut state = self.memo.inferred_types.get(&subject);
        if state.is_none() {
            self.find_cycles_from(subject);
            state = self.memo.inferred_types.get(&subject);
        }
        match state {
            Some(&TypeState::Member { cycle }) => {
                self.memo.types_in_progress.cycles[cycle as usize].take()
            }
            _ => None,
        }
    }

    /// Whatever was found earlier leads to nothing that is found now, or that would have been found then.
    fn find_cycles_from(&mut self, start: Subject) {
        let mut path: SmallVec<[SubjectSearched; 4]> = SmallVec::new();
        let mut open: SmallVec<[Subject; 8]> = SmallVec::new();
        let mut next = Some(start);
        let mut count = 0;
        loop {
            if let Some(subject) = next.take() {
                let asks_for = self.find_subjects_asked_for(subject);
                let types = &mut self.memo.inferred_types;
                let leads_on = asks_for.iter().any(|asked_for| match types.get(asked_for) {
                    Some(TypeState::Searched { .. }) | None => *asked_for != subject,
                    Some(_) => false,
                });
                if leads_on {
                    let index = count;
                    count += 1;
                    types.insert(subject, TypeState::Searched { index });
                    open.push(subject);
                    path.push(SubjectSearched {
                        subject,
                        index,
                        lowest_index: index,
                        asks_for,
                        next: 0,
                    });
                } else {
                    types.insert(subject, TypeState::Alone);
                }
            }
            let Some(searched) = path.last_mut() else {
                return;
            };
            if let Some(&asked_for) = searched.asks_for.get(searched.next) {
                searched.next += 1;
                match self.memo.inferred_types.get(&asked_for) {
                    Some(&TypeState::Searched { index }) => {
                        searched.lowest_index = searched.lowest_index.min(index);
                    }
                    Some(_) => {}
                    None => next = Some(asked_for),
                }
                continue;
            }
            let (subject, index, lowest_index) =
                (searched.subject, searched.index, searched.lowest_index);
            path.pop();
            if let Some(asked_for_it) = path.last_mut() {
                asked_for_it.lowest_index = asked_for_it.lowest_index.min(lowest_index);
            }
            if lowest_index != index {
                continue;
            }
            if open.last() == Some(&subject) {
                open.pop();
                self.memo.inferred_types.insert(subject, TypeState::Alone);
                continue;
            }
            let first = open.iter().rposition(|&other| other == subject);
            let mut members: Vec<Subject> = open.drain(first.unwrap_or(0)..).collect();
            members.sort_unstable();
            let cycles = &mut self.memo.types_in_progress.cycles;
            let cycle = cycles.len() as u32;
            for &member in &members {
                let state = TypeState::Member { cycle };
                self.memo.inferred_types.insert(member, state);
            }
            cycles.push(Some(members.into_boxed_slice()));
        }
    }

    /// The subjects that the type of this one may be made from, whatever their types are.
    fn find_subjects_asked_for(&mut self, subject: Subject) -> Subjects {
        let mut asked_for = Subjects::new();
        match subject {
            Subject::Binding(symbol) => {
                self.add_subjects_a_binding_asks_for(symbol, &mut asked_for);
            }
            Subject::Expression(expression) => {
                if let Some(referenced) = self.find_referenced_subject(expression) {
                    if !matches!(referenced, Subject::This(_)) {
                        asked_for.push(referenced);
                    }
                    return asked_for;
                }
                let receiver = self.find_untyped_receiver(expression);
                asked_for.extend(receiver.map(Subject::Expression));
                let receiver = self.find_untyped_receiver_of_method_call(expression);
                asked_for.extend(receiver.map(Subject::Expression));
                asked_for.extend(self.find_result_subject_of_call(expression));
            }
            Subject::Result(function) => {
                for (returned, checked) in self.find_returned_expressions(function) {
                    asked_for.extend(self.find_subject_of_expression(returned, checked));
                }
            }
            Subject::Number(symbol) => {
                let mut walk = Walk::new(self.inputs.max_inference_nodes);
                walk.numbers_listed = Some(asked_for);
                self.holds_integers(&mut walk, symbol);
                return walk.numbers_listed.unwrap_or_default();
            }
            Subject::Pattern(_) | Subject::This(_) => {}
        }
        asked_for
    }

    fn add_subjects_a_binding_asks_for(&mut self, symbol: SymbolId, asked_for: &mut Subjects) {
        let &[Decl::Param(name)] = self.bound().symbol(symbol).decls else {
            if let Some(initializer) = self.find_initializer_of_constant(symbol) {
                let receiver = self.find_untyped_receiver_of_method_call(initializer);
                asked_for.extend(receiver.map(Subject::Expression));
            }
            return;
        };
        let declared = self.find_declared_parameter_type(name);
        if !self.c.is_any(declared) {
            return;
        }
        let mut walk = Walk::new(self.inputs.max_inference_nodes);
        if let Some(usage) = self.usage_of(&mut walk, Subject::Binding(symbol))
            && usage.members.is_empty()
            && !usage.is_incomplete()
        {
            let used_as = self.type_of_usage(&usage);
            if !self.c.is_any(used_as) {
                return;
            }
        }
        for argument in self.find_arguments_given(name).unwrap_or_default() {
            if let Some(argument) = argument.some()
                && let Ok(checked) = self.expression_type(argument)
            {
                asked_for.extend(self.find_subject_of_expression(argument, checked));
            }
        }
    }

    fn compute_binding_type(&mut self, symbol: SymbolId) -> TypeId {
        let &[Decl::Param(name)] = self.bound().symbol(symbol).decls else {
            // Uses only guess: what a constant is made from knows.
            return match self.find_type_a_constant_is_made_with(symbol) {
                Some(made) => made,
                None => self.compute_type_from_uses(Subject::Binding(symbol)),
            };
        };
        let declared = self.find_declared_parameter_type(name);
        if !self.c.is_any(declared) {
            return declared;
        }
        let used_as = self.compute_type_from_uses(Subject::Binding(symbol));
        if self.c.is_any(used_as) {
            return self.compute_type_from_arguments(name);
        }
        let mut walk = Walk::new(self.inputs.max_inference_nodes);
        let Some(usage) = self.usage_of(&mut walk, Subject::Binding(symbol)) else {
            return used_as;
        };
        if usage.members.is_empty() && !usage.is_incomplete() {
            return used_as;
        }
        // Uses only guess what a member holds: `a.codes[i]` reads as an array whatever `a.codes` is. What every caller
        // passes knows, so it wins when it has each member the uses name.
        let given = self.compute_type_from_arguments(name);
        match !self.c.is_any(given) && self.has_every_member(given, &usage.members) {
            true => given,
            false => used_as,
        }
    }

    /// `const kept = list.filter(..)`. It asks nothing of the uses of the initializer, which are the uses of the constant.
    fn find_type_a_constant_is_made_with(&mut self, symbol: SymbolId) -> Option<TypeId> {
        let initializer = self.find_initializer_of_constant(symbol)?;
        let made = self.find_result_of_inferred_method(initializer)?;
        // A list of anything says less than the uses of its elements may.
        match self.c.array_element(made) {
            Some(element) if self.c.is_any(element) => None,
            Some(_) | None => Some(made),
        }
    }

    fn find_initializer_of_constant(&self, symbol: SymbolId) -> Option<ExprId> {
        let (hir, bound) = (self.hir(), self.bound());
        let &[Decl::Var(name)] = bound.symbol(symbol).decls else {
            return None;
        };
        let PatParent::Var(variable) = bound.pat_parent[name.idx()] else {
            return None;
        };
        match hir[variable].kind {
            VarKind::Const => hir[variable].init.some(),
            _ => None,
        }
    }

    /// What each call passes for the parameter, `ExprId::NONE` where it passes nothing. `None`: not every call is known.
    fn find_arguments_given(&mut self, name: PatId) -> Option<SmallVec<[ExprId; 4]>> {
        let (hir, bound) = (self.hir(), self.bound());
        let PatParent::Param(parameter) = bound.pat_parent[name.idx()] else {
            return None;
        };
        let function = bound.param_fn[parameter.idx()];
        if function == FnId::NONE || hir[parameter].flags.contains(Flags::REST) {
            return None;
        }
        let index = hir[function].params.position_of(parameter.idx())?;
        let callee = find_name_of_function(hir, bound, function)?;
        let references = references_to(self.reference_index().to_bindings, callee);
        if references.len() > MAX_CALLS_READ || self.is_exported(callee) {
            return None;
        }
        let first_spreads = &mut self.memo.first_spread_arguments;
        let arguments = references.iter().map(|&(_, reference)| {
            find_argument_of_call(hir, bound, first_spreads, reference, index)
        });
        arguments.collect()
    }

    fn compute_type_from_arguments(&mut self, name: PatId) -> TypeId {
        let Some(arguments) = self.find_arguments_given(name) else {
            return TypeId::ANY;
        };
        let mut parts = TypeParts::new();
        for argument in arguments {
            let given = match argument.some() {
                Some(argument) => self.predicted_expression_type(argument),
                None => Ok(TypeId::UNDEFINED),
            };
            match given {
                Ok(given) if !self.c.is_any(given) => parts.push(self.c.base_of_literal(given)),
                Ok(_) | Err(_) => return TypeId::ANY,
            }
        }
        match parts[..] {
            [] | [TypeId::UNDEFINED] => TypeId::ANY,
            _ => self.c.union(&parts),
        }
    }

    fn is_exported(&mut self, symbol: SymbolId) -> bool {
        let files = self.files();
        let symbol = files.sym(self.file, symbol);
        let file = self.file;
        let exported = self.memo.exported_symbols.get_or_insert_with(|| {
            let exports = files.exports_of_module(files.file_symbol(file));
            let resolved = exports
                .iter()
                .filter_map(|&(_, export)| files.resolve_alias_if_needed(export));
            resolved.collect()
        });
        exported.contains(&symbol)
    }

    fn compute_result_type(&mut self, function: FnId) -> TypeId {
        let mut result = Usage::default();
        for (returned, checked) in self.find_returned_expressions(function) {
            let expected = self.infer_expression_type(returned, checked);
            let expected = self.c.widened(expected);
            self.add_arm(&mut result, expected);
        }
        self.type_of_usage(&result)
    }

    /// Each with its checked type.
    fn find_returned_expressions(&mut self, function: FnId) -> ReturnedExpressions {
        let (hir, bound) = (self.hir(), self.bound());
        let mut found = ReturnedExpressions::new();
        match hir[function].body {
            FnBody::None => {}
            FnBody::Expr(returned) => self.add_returned_expressions(returned, &mut found),
            FnBody::Block(_) => {
                for statement in bound.ids(bound.fns[function.idx()].returns) {
                    if let StmtKind::Return(returned) = hir[statement].kind
                        && returned.is_some()
                    {
                        self.add_returned_expressions(returned, &mut found);
                    }
                }
            }
        }
        found
    }

    fn add_returned_expressions(&mut self, returned: ExprId, found: &mut ReturnedExpressions) {
        if self.c.is_stack_low() {
            return;
        }
        let Ok(checked) = self.expression_type(returned) else {
            return;
        };
        let alternatives = find_alternatives(self.hir(), returned);
        if self.c.is_any(checked) && !alternatives.is_empty() {
            for alternative in alternatives {
                self.add_returned_expressions(alternative, found);
            }
            return;
        }
        found.push((returned, checked));
    }

    fn compute_number_type(&mut self, symbol: SymbolId) -> TypeId {
        let mut walk = Walk::new(self.inputs.max_inference_nodes);
        match self.c.p.aot_symbols().int32_alias() {
            Some(int32) if self.holds_integers(&mut walk, symbol) => self.c.declared_type(int32),
            Some(_) | None => TypeId::ANY,
        }
    }

    fn holds_integers(&mut self, walk: &mut Walk, symbol: SymbolId) -> bool {
        let (hir, bound) = (self.hir(), self.bound());
        let references = self.reference_index().to_bindings;
        let answers = &mut self.memo.sums_used_as_int32;
        let has_int32_use = references_to(references, symbol)
            .iter()
            .any(|&(_, reference)| is_used_as_int32(hir, bound, reference, answers));
        has_int32_use
            && self.starts_as_integer(walk, symbol)
            && self.gets_only_integers(walk, symbol)
    }

    fn starts_as_integer(&mut self, walk: &mut Walk, symbol: SymbolId) -> bool {
        let (hir, bound) = (self.hir(), self.bound());
        let mut has_initializer = false;
        for &declaration in bound.symbol(symbol).decls {
            let Decl::Var(name) = declaration else {
                return false;
            };
            let PatParent::Var(variable) = bound.pat_parent[name.idx()] else {
                return false;
            };
            if let Some(initializer) = hir[variable].init.some() {
                if !self.is_integer(walk, initializer) {
                    return false;
                }
                has_initializer = true;
            }
        }
        has_initializer
    }

    fn gets_only_integers(&mut self, walk: &mut Walk, symbol: SymbolId) -> bool {
        let (hir, bound) = (self.hir(), self.bound());
        bound
            .stores_to(symbol)
            .iter()
            .all(|store| match store.kind {
                StoreKind::Update(_) => true,
                StoreKind::Assign | StoreKind::CompoundAssign(_) => {
                    match find_use(hir, bound, store.target) {
                        Use::Stored { op, value } => self.stores_integer(walk, op, value),
                        Use::Nothing
                        | Use::PassedOn(_)
                        | Use::Initializes(_)
                        | Use::Destructured(_)
                        | Use::Member { .. }
                        | Use::Keyed { .. }
                        | Use::Key { .. }
                        | Use::Called { .. }
                        | Use::Argument { .. }
                        | Use::Iterated(_)
                        | Use::Object { .. }
                        | Use::Number
                        | Use::Int32
                        | Use::Updated
                        | Use::AddedTo(_)
                        | Use::ComparedWith(_) => false,
                    }
                }
                StoreKind::Destructure | StoreKind::ForIn | StoreKind::ForOf => false,
            })
    }

    fn stores_integer(&mut self, walk: &mut Walk, op: Option<BinOp>, value: ExprId) -> bool {
        match op {
            None | Some(BinOp::Add | BinOp::Sub | BinOp::And | BinOp::Or | BinOp::Nullish) => {
                let checked = self.expression_type(value);
                let is_unknown = checked.is_ok_and(|checked| self.c.is_any(checked));
                is_unknown || self.is_integer(walk, value)
            }
            Some(op) => yields_int32(op),
        }
    }

    fn is_integer(&mut self, walk: &mut Walk, expression: ExprId) -> bool {
        if self.c.is_stack_low() || !walk.enter_node() {
            return false;
        }
        let Ok(checked) = self.expression_type(expression) else {
            return false;
        };
        if self.is_int32_type(checked) {
            return true;
        }
        if let Some(subject) = self.find_number_subject(expression, checked) {
            return match &mut walk.numbers_listed {
                Some(listed) => {
                    listed.push(subject);
                    true
                }
                None => self.is_expected_int32(subject),
            };
        }
        let hir = self.hir();
        if let Some((object, MemberKey::Name(name))) = hir.member_key(expression) {
            return name == known::length && self.is_list(object);
        }
        if let ExprKind::Unary { op, .. } = hir[expression].kind {
            return op == UnOp::BitNot;
        }
        let ExprKind::Binary { op, left, right } = hir[expression].kind else {
            return false;
        };
        let is_sum = matches!(op, BinOp::Add | BinOp::Sub);
        yields_int32(op) || is_sum && self.is_integer(walk, left) && self.is_integer(walk, right)
    }

    fn is_int32_type(&mut self, ty: TypeId) -> bool {
        let int32 = self.c.p.aot_symbols().int32_alias();
        let int32 = int32.map(|alias| self.c.declared_type(alias));
        self.c.every_type(ty, |c, part| {
            let is_int32_literal = matches!(
                c.data(part),
                TypeData::NumberLit { bits, .. } if is_int32_value(f64::from_bits(*bits))
            );
            is_int32_literal || Some(part) == int32
        })
    }

    fn is_expected_int32(&mut self, number: Subject) -> bool {
        if let Some(&TypeState::InProgress {
            depth,
            assumed: None,
        }) = self.memo.inferred_types.get(&number)
        {
            self.memo.types_in_progress.subjects.revisit(depth as usize);
            return true;
        }
        let inferred = self.inferred_type(number);
        !self.c.is_any(inferred)
    }

    fn compute_expression_type(&mut self, expression: ExprId) -> TypeId {
        if self.c.is_stack_low() {
            return TypeId::ANY;
        }
        if let Some(subject) = self.find_referenced_subject(expression) {
            return self.inferred_type(subject);
        }
        if let Some(found) = self.find_type_in_inferred_receiver(expression)
            && !self.c.is_any(found)
        {
            return found;
        }
        if let Some(result) = self.find_result_of_inferred_method(expression) {
            return result;
        }
        if let Some(subject) = self.find_result_subject_of_call(expression) {
            let result = self.inferred_type(subject);
            if !self.c.is_any(result) {
                return result;
            }
        }
        self.compute_type_from_uses(Subject::Expression(expression))
    }

    fn find_untyped_receiver(&mut self, access: ExprId) -> Option<ExprId> {
        let (object, _) = self.hir().member_key(access)?;
        let checked = self.expression_type(object).ok()?;
        self.c.is_any(checked).then_some(object)
    }

    fn find_untyped_receiver_of_method_call(&mut self, call: ExprId) -> Option<ExprId> {
        let hir = self.hir();
        match hir[call].kind {
            ExprKind::Call(site) => self.find_untyped_receiver(hir[site].callee),
            _ => None,
        }
    }

    fn find_type_in_inferred_receiver(&mut self, access: ExprId) -> Option<TypeId> {
        let (_, key) = self.hir().member_key(access)?;
        let object = self.find_untyped_receiver(access)?;
        let receiver = self.inferred_type(Subject::Expression(object));
        if self.c.is_any(receiver) {
            return None;
        }
        let name = match key {
            MemberKey::Name(name) => name,
            MemberKey::PrivateName(_) => return None,
            MemberKey::Computed(key) => {
                let key_type = self.expression_type(key).ok()?;
                if self.is_number_type(key_type) {
                    return self.find_element_type(receiver);
                }
                self.c.property_name_of_type(key_type)?
            }
        };
        match self.find_member(receiver, name).ok()? {
            MemberLookup::Member(member) => member.types.checked.ok(),
            MemberLookup::Index(signature) => signature.types.checked.ok(),
            MemberLookup::Absent => None,
        }
    }

    fn find_result_of_inferred_method(&mut self, call: ExprId) -> Option<TypeId> {
        let hir = self.hir();
        let ExprKind::Call(site) = hir[call].kind else {
            return None;
        };
        let callee = hir[site].callee;
        hir.member_key(callee)?;
        let method = self.find_type_in_inferred_receiver(callee)?;
        // `filter<S extends T>(..): S[]` beside `filter(..): T[]`: a result that hangs on the call says nothing here.
        let mut result = None;
        for &signature in self.c.signatures(method, false).iter() {
            let returned = self.c.sig_return(signature);
            if self.c.has_type_variables(returned) {
                continue;
            }
            if result.is_some_and(|result| result != returned) {
                return None;
            }
            result = Some(returned);
        }
        result.filter(|&result| !self.c.is_any(result))
    }

    fn find_element_type(&mut self, list: TypeId) -> Option<TypeId> {
        let mut elements = TypeParts::new();
        for &part in self.c.parts(list) {
            if self.c.is_string_like(part) {
                elements.push(TypeId::STRING);
            } else {
                elements.push(self.c.array_element(part)?);
            }
        }
        Some(self.c.union(&elements))
    }

    fn compute_type_from_uses(&mut self, subject: Subject) -> TypeId {
        let mut walk = Walk::new(self.inputs.max_inference_nodes);
        match self.usage_of(&mut walk, subject) {
            Some(usage) => self.type_of_usage(&usage),
            None => TypeId::ANY,
        }
    }

    fn reference_index(&mut self) -> ReferenceIndex<'c> {
        if let Some(index) = self.memo.reference_index {
            return index;
        }
        let index = self.compute_reference_index();
        self.memo.reference_index = Some(index);
        index
    }

    fn compute_reference_index(&mut self) -> ReferenceIndex<'c> {
        let (file, hir, bound) = (self.file, self.hir(), self.bound());
        let expressions = self.c.exprs_by_kind(file);
        let mut to_bindings = Vec::new();
        for &reference in expressions.of(ExprTag::Ident) {
            let is_evaluated = bound.is_evaluated_ident(reference)
                && self.require_live_expression(reference).is_ok();
            match bound.binding(reference) {
                Binding::Symbol(symbol) if is_evaluated => to_bindings.push((symbol, reference)),
                Binding::Symbol(_)
                | Binding::Arguments(_)
                | Binding::CommonJs(_)
                | Binding::Free => {}
            }
        }
        let mut to_this = Vec::new();
        for &reference in expressions.of(ExprTag::This) {
            let is_evaluated = self.require_live_expression(reference).is_ok();
            match self.c.this_container(file, reference) {
                Some(Ok(function)) if is_evaluated => to_this.push((function, reference)),
                Some(Ok(_) | Err(_)) | None => {}
            }
        }
        to_bindings
            .sort_unstable_by_key(|&(symbol, reference)| (symbol, hir[reference].pos, reference));
        to_this.sort_unstable_by_key(|&(function, reference)| {
            (function, hir[reference].pos, reference)
        });
        ReferenceIndex {
            to_bindings: self.list(&to_bindings),
            to_this: self.list(&to_this),
        }
    }

    fn usage_of(&mut self, walk: &mut Walk, subject: Subject) -> Option<Rc<Usage>> {
        let is_outermost = walk.lowest_index == usize::MAX;
        let usage = self.usage_within_reach(walk, subject);
        match is_outermost && walk.is_freeing_stack {
            true => self.walk_subjects_set_aside(walk),
            false => usage,
        }
    }

    #[cold]
    fn walk_subjects_set_aside(&mut self, walk: &mut Walk) -> Option<Rc<Usage>> {
        let mut first_set_aside = 0;
        loop {
            // The innermost left the stack first.
            walk.set_aside[first_set_aside..].reverse();
            walk.is_freeing_stack = false;
            let mut usage = None;
            while !walk.is_freeing_stack {
                let Some(innermost) = walk.set_aside.pop() else {
                    return usage;
                };
                first_set_aside = walk.set_aside.len();
                usage = self.walk_subject(walk, innermost, true);
                if !walk.is_freeing_stack
                    && let Some(asked_for_it) = walk.set_aside.last_mut()
                {
                    asked_for_it.lowest_index = walk.lowest_index;
                    asked_for_it.found_something_new = walk.found_something_new;
                }
            }
        }
    }

    fn usage_within_reach(&mut self, walk: &mut Walk, subject: Subject) -> Option<Rc<Usage>> {
        if walk.is_freeing_stack {
            return None;
        }
        let unstable_answers = self.count_unstable_answers() + walk.subjects_not_kept;
        let is_outermost = walk.lowest_index == usize::MAX;
        if is_outermost {
            (walk.unstable_answers_at_start, walk.shares_budget) = (unstable_answers, false);
        }
        let assumed = match self.memo.usages.get(&subject) {
            Some(UsageState::Known(usage)) => return Some(Rc::clone(usage)),
            Some(UsageState::InProgress { index, assumed }) => {
                walk.lowest_index = walk.lowest_index.min(*index);
                return assumed.clone();
            }
            Some(UsageState::InCycle { index, found }) => {
                walk.lowest_index = walk.lowest_index.min(*index);
                return Some(Rc::clone(found));
            }
            Some(UsageState::Assumed(usage)) => Some(Rc::clone(usage)),
            Some(UsageState::NotKept) => {
                walk.shares_budget = true;
                None
            }
            None => None,
        };
        // What a subject that is walked again asks for is walked, so each time the stack is freed the walk gets further.
        if walk.subjects_on_stack > 1 && self.c.is_half_of_stack_in_use() {
            walk.is_freeing_stack = true;
            return None;
        }
        walk.shares_budget |= unstable_answers != walk.unstable_answers_at_start;
        let entered = SubjectInProgress {
            subject,
            is_outermost,
            unstable_answers,
            assumed,
            index: 0,
            first_in_cycle: walk.in_cycles.len(),
            first_in_round: 0,
            lowest_index: 0,
            found_something_new: false,
            outer_lowest: walk.lowest_index,
            outer_nodes: walk.remaining_nodes,
            outer_root: walk.root,
            outer_found_something_new: std::mem::take(&mut walk.found_something_new),
        };
        self.walk_subject(walk, entered, false)
    }

    fn walk_subject(
        &mut self,
        walk: &mut Walk,
        mut entered: SubjectInProgress,
        mut was_set_aside: bool,
    ) -> Option<Rc<Usage>> {
        let (subject, is_outermost) = (entered.subject, entered.is_outermost);
        let can_be_merged = match subject {
            Subject::Binding(_) | Subject::Pattern(_) | Subject::This(_) => true,
            Subject::Result(_) | Subject::Expression(_) | Subject::Number(_) => false,
        };
        let (usage, is_stable, is_entry_of_cycle) = loop {
            if was_set_aside {
                walk.lowest_index = entered.lowest_index;
                walk.found_something_new = entered.found_something_new;
                was_set_aside = false;
            } else {
                // A walk that begins inside another goes on counting, so what it runs into of the other is further out.
                entered.index = self.memo.types_in_progress.next_usage_index;
                self.memo.types_in_progress.next_usage_index += 1;
                let state = UsageState::InProgress {
                    index: entered.index,
                    assumed: entered.assumed.clone(),
                };
                self.memo.usages.insert(subject, state);
                walk.lowest_index = entered.index;
                entered.first_in_round = walk.in_cycles.len();
            }
            if is_outermost || !walk.shares_budget {
                walk.remaining_nodes = walk.max_nodes;
            }
            self.statistics.usages_walked += 1;
            walk.subjects_on_stack += 1;
            let mut found = self.ask(|queries| Ok(queries.compute_usage(walk, subject)));
            walk.subjects_on_stack -= 1;
            if walk.is_freeing_stack {
                entered.lowest_index = walk.lowest_index;
                entered.found_something_new = walk.found_something_new;
                walk.lowest_index = entered.outer_lowest;
                walk.found_something_new = entered.outer_found_something_new;
                walk.root = entered.outer_root;
                walk.set_aside.push(entered);
                return None;
            }
            if let (Ok(found), Some(assumed)) = (&mut found, &entered.assumed)
                && *found != **assumed
            {
                found.merge(&mut Walk::new(u64::MAX), assumed);
                if found.is_incomplete() {
                    found.forget_parts();
                }
            }
            let usage = found.ok().map(Rc::new);
            walk.found_something_new |= usage != entered.assumed;
            let is_stable =
                self.count_unstable_answers() + walk.subjects_not_kept == entered.unstable_answers;
            walk.shares_budget |= !is_stable;
            let is_entry_of_cycle =
                walk.lowest_index == entered.index && walk.in_cycles.len() > entered.first_in_round;
            if !is_entry_of_cycle || !walk.found_something_new || walk.shares_budget {
                break (usage, is_stable, is_entry_of_cycle);
            }
            for &other in &walk.in_cycles[entered.first_in_round..] {
                if let Some(state) = self.memo.usages.get_mut(&other)
                    && let UsageState::InCycle { found, .. } = state
                {
                    *state = UsageState::Assumed(Rc::clone(found));
                }
            }
            (entered.assumed, walk.found_something_new) = (usage, false);
        };
        let (index, first_in_cycle) = (entered.index, entered.first_in_cycle);
        let leads_back = walk.lowest_index < index;
        let has_settled = !walk.found_something_new || !is_entry_of_cycle;
        let is_cut_short = walk.shares_budget && walk.is_out_of_budget();
        let found_something_new = std::mem::replace(
            &mut walk.found_something_new,
            entered.outer_found_something_new,
        );
        walk.root = entered.outer_root;
        walk.remaining_nodes = match walk.shares_budget && !is_outermost {
            true => entered.outer_nodes.min(walk.remaining_nodes),
            false => entered.outer_nodes,
        };
        if leads_back && !is_outermost {
            walk.lowest_index = walk.lowest_index.min(entered.outer_lowest);
            walk.found_something_new |= found_something_new;
            walk.in_cycles.push(subject);
            let found = usage.clone().unwrap_or_default();
            let state = UsageState::InCycle { index, found };
            self.memo.usages.insert(subject, state);
            return usage;
        }
        walk.lowest_index = entered.outer_lowest;
        let is_kept = can_be_merged && is_stable && has_settled && !leads_back && !is_cut_short;
        for other in walk.in_cycles.drain(first_in_cycle..) {
            let Some(state) = self.memo.usages.get_mut(&other) else {
                continue;
            };
            match state {
                UsageState::InCycle { found, .. } if is_kept => {
                    *state = UsageState::Known(Rc::clone(found));
                }
                UsageState::InCycle { .. } => {
                    *state = UsageState::NotKept;
                    if self.lacks_stack {
                        self.memo.usages_that_lacked_stack.push(other);
                    }
                }
                UsageState::Assumed(_) => {
                    self.memo.usages.remove(&other);
                }
                UsageState::InProgress { .. } | UsageState::Known(_) | UsageState::NotKept => {}
            }
        }
        match &usage {
            Some(usage) if is_kept => {
                let known = UsageState::Known(Rc::clone(usage));
                self.memo.usages.insert(subject, known);
            }
            Some(_) | None => {
                walk.subjects_not_kept += 1;
                match can_be_merged {
                    true => self.memo.usages.insert(subject, UsageState::NotKept),
                    false => self.memo.usages.remove(&subject),
                };
                if can_be_merged && self.lacks_stack {
                    self.memo.usages_that_lacked_stack.push(subject);
                }
            }
        }
        usage
    }

    /// With the stack free the checker answers what it gave up on, so they are walked as if for the first time. As
    /// `NotKept` they would never be kept where a cycle is longer than one budget, nor would whatever leads to them.
    pub(super) fn forget_usages_that_lacked_stack(&mut self) {
        for subject in self.memo.usages_that_lacked_stack.drain(..) {
            if let Some(UsageState::NotKept) = self.memo.usages.get(&subject) {
                self.memo.usages.remove(&subject);
            }
        }
    }

    fn compute_usage(&mut self, walk: &mut Walk, subject: Subject) -> Usage {
        let mut usage = Usage::default();
        walk.root = &raw const usage;
        match subject {
            Subject::Binding(symbol) => {
                let references = self.reference_index().to_bindings;
                for &(_, reference) in references_to(references, symbol) {
                    self.add_evidence(walk, reference, &mut usage);
                }
            }
            Subject::This(function) => {
                let references = self.reference_index().to_this;
                for &(_, reference) in references_to(references, function) {
                    let checked = self.expression_type(reference);
                    if checked.is_ok_and(|checked| self.c.is_any(checked)) {
                        self.add_evidence(walk, reference, &mut usage);
                    }
                }
            }
            Subject::Pattern(pattern) => self.add_uses_of_pattern(walk, pattern, &mut usage),
            Subject::Expression(expression) => self.add_evidence(walk, expression, &mut usage),
            Subject::Result(_) | Subject::Number(_) => {
                debug_assert!(
                    false,
                    "what is returned types a result and what is stored a number, not their uses"
                );
            }
        }
        if walk.is_out_of_budget() {
            usage.facts |= Facts::INCOMPLETE;
        }
        if usage.is_incomplete() {
            usage.forget_parts();
        }
        usage
    }

    fn add_uses_of_subject(&mut self, walk: &mut Walk, subject: Subject, usage: &mut Usage) {
        let is_part = !std::ptr::eq(usage, walk.root);
        let Some(found) = self.usage_of(walk, subject) else {
            return;
        };
        let is_kept = matches!(self.memo.usages.get(&subject), Some(UsageState::Known(_)));
        if is_part && !is_kept {
            return;
        }
        let own_stores = Facts::STORED | Facts::OBJECT_LITERAL_STORED;
        let is_stored = usage.facts & own_stores;
        usage.merge(walk, &found);
        usage.facts = (usage.facts - own_stores) | is_stored;
    }

    fn calls_its_object(&self, access: ExprId) -> bool {
        let named = self.inputs.named_values.find_named_value(self.file, access);
        matches!(
            named,
            Some(NamedValue::PrototypeOperation(
                PrototypeOperation::CallFunction { .. }
            ))
        )
    }

    fn add_evidence(&mut self, walk: &mut Walk, value: ExprId, usage: &mut Usage) {
        if self.c.is_stack_low() || !walk.enter_node_of(usage) {
            return;
        }
        let Ok(checked) = self.expression_type(value) else {
            return;
        };
        if !self.c.is_any(checked) {
            self.add_arm(usage, checked);
            return;
        }
        match find_use(self.hir(), self.bound(), value) {
            Use::Nothing => {}
            Use::PassedOn(outer) => self.add_evidence(walk, outer, usage),
            Use::Initializes(pattern) => self.add_uses_of_pattern(walk, pattern, usage),
            Use::Destructured(pattern) => self.add_members_of_assignment_pattern(pattern, usage),
            Use::Member {
                access,
                name,
                is_optional,
            } => {
                usage.facts |= required_if(!is_optional);
                match self.calls_its_object(access) {
                    true => usage.facts |= Facts::FUNCTION,
                    false if walk.is_out_of_budget() => {}
                    false => {
                        self.add_evidence(walk, access, usage.member_mut(name));
                        self.add_uses_of_elements_in_callbacks(walk, access, name, usage);
                    }
                }
            }
            Use::Keyed {
                access,
                key,
                is_optional,
            } => {
                usage.facts |= required_if(!is_optional);
                self.add_keyed_access(walk, access, key, usage);
            }
            Use::Key { object } => {
                usage.facts |= match self.is_list(object) {
                    true => Facts::NUMBER_AT_EVERY_VALUE | Facts::INT32,
                    false => Facts::KEY,
                };
            }
            Use::Called { is_optional } => {
                usage.facts |= Facts::FUNCTION;
                usage.facts |= required_if(!is_optional);
            }
            Use::Argument { call, index } => self.add_uses_of_argument(walk, call, index, usage),
            Use::Iterated(pattern) => {
                usage.facts |= Facts::REQUIRED;
                let elements = usage.elements_mut();
                if let Some(pattern) = pattern {
                    self.add_uses_of_pattern(walk, pattern, elements);
                }
            }
            Use::Object { is_required } => {
                usage.facts |= Facts::OBJECT;
                usage.facts |= required_if(is_required);
            }
            Use::Number => usage.facts |= self.number_fact_of_operand(value),
            Use::Int32 => {
                usage.facts |= self.number_fact_of_operand(value);
                if !is_given_product(self.hir(), self.bound(), value) {
                    usage.facts |= Facts::INT32;
                }
            }
            Use::Updated => {
                usage.facts |= Facts::NUMBER_AT_EVERY_VALUE | Facts::STORED;
                self.add_use_of_update(value, usage);
            }
            Use::AddedTo(other) => self.add_addition(other, usage),
            Use::ComparedWith(other) => self.add_comparison(other, usage),
            Use::Stored { op, value } => self.add_store(op, value, usage),
        }
    }

    /// `list.filter(x => x > 2)`: a list hands its elements to the callback, so what the callback does with them says
    /// what the list holds.
    fn add_uses_of_elements_in_callbacks(
        &mut self,
        walk: &mut Walk,
        access: ExprId,
        method: Atom,
        usage: &mut Usage,
    ) {
        let (hir, bound) = (self.hir(), self.bound());
        let Parent::Expr(call) = bound.parent_of_expr(access) else {
            return;
        };
        let Some(call) = call.some() else {
            return;
        };
        let ExprKind::Call(site) = hir[call].kind else {
            return;
        };
        if hir[site].callee != access {
            return;
        }
        for (index, argument) in hir.ids(hir[site].args).enumerate() {
            let callback = match hir[argument].kind {
                ExprKind::Fn(callback) => callback,
                ExprKind::Spread(_) => break,
                _ => continue,
            };
            let taking_elements = self.find_parameters_taking_elements(method, index);
            for (position, parameter) in hir[callback].params.iter().enumerate().take(8) {
                if taking_elements & (1 << position) == 0 {
                    continue;
                }
                let Ok(checked) = self.checked_binding_type(hir[parameter].pat) else {
                    continue;
                };
                let subject = self.find_parameter_subject(self.file, parameter, checked);
                let Some(subject) = subject else {
                    continue;
                };
                let mut found = Usage::default();
                self.add_uses_of_subject(walk, subject, &mut found);
                if !found.facts.contains(Facts::NUMBER_AT_EVERY_VALUE) {
                    found.facts -= Facts::NUMBER | Facts::INT32;
                }
                let says = self.type_of_usage(&found);
                if self.is_number_type(says) || self.is_string_type(says) {
                    usage.elements_mut().merge(walk, &found);
                }
            }
        }
    }

    /// Which parameters of the callback that a list's method takes at `index` are elements of the list: a bit each.
    fn find_parameters_taking_elements(&mut self, method: Atom, index: usize) -> u8 {
        if let Some(&known) = self.memo.parameters_taking_elements.get(&(method, index)) {
            return known;
        }
        // No method of a list names `never` by itself, so a parameter of that type has the type of the elements.
        let list = self.c.array_of(TypeId::NEVER);
        let mut taking_elements = 0;
        let signatures = match self.c.type_of_property(list, method) {
            Some(method) => self.c.signatures(method, false),
            None => Default::default(),
        };
        for &signature in signatures.iter() {
            let parameters = self.c.sig_params(signature);
            let Some(callback) = find_parameter(&parameters, index) else {
                continue;
            };
            let callback = self.without_nullish(callback.ty).unwrap_or(callback.ty);
            for &signature in self.c.signatures(callback, false).iter() {
                let parameters = self.c.sig_params(signature);
                for (position, parameter) in parameters.iter().enumerate().take(8) {
                    if parameter.ty == TypeId::NEVER && !parameter.rest {
                        taking_elements |= 1 << position;
                    }
                }
            }
        }
        let known = &mut self.memo.parameters_taking_elements;
        known.insert((method, index), taking_elements);
        taking_elements
    }

    fn number_fact_of_operand(&self, operand: ExprId) -> Facts {
        match is_evaluated_for_some_values_only(self.hir(), self.bound(), operand) {
            true => Facts::NUMBER,
            false => Facts::NUMBER_AT_EVERY_VALUE,
        }
    }

    fn add_arm(&mut self, usage: &mut Usage, ty: TypeId) {
        if let Ok(ty) = self.without_nullish(ty) {
            let holds_nothing = self.c.array_element(ty).is_some_and(TypeId::is_never);
            let ty = match holds_nothing {
                true => self.c.array_of(TypeId::ANY),
                false => ty,
            };
            let says_nothing = self.c.is_any(ty)
                || ty == TypeId::UNKNOWN
                || ty.is_never()
                || ty != TypeId::OBJECT && self.c.is_empty_object_type(ty);
            if !says_nothing {
                usage.add_arm(ty);
            }
        }
    }

    fn is_number_type(&self, ty: TypeId) -> bool {
        self.c.every_type(ty, |c, part| c.is_number_like(part))
    }

    fn is_string_type(&self, ty: TypeId) -> bool {
        self.c.every_type(ty, |c, part| c.is_string_like(part))
    }

    fn is_list(&mut self, object: ExprId) -> bool {
        let Ok(ty) = self.expression_type(object) else {
            return false;
        };
        self.c.every_type(ty, |c, part| {
            c.is_array_or_tuple(part) || c.is_string_like(part)
        })
    }

    /// `list[i++]`, `--n >= 0`: what the update hands on is the variable a step ago or a step on.
    fn add_use_of_update(&mut self, updated: ExprId, usage: &mut Usage) {
        let (hir, bound) = (self.hir(), self.bound());
        let Parent::Expr(update) = bound.parent_of_expr(updated) else {
            return;
        };
        let Some(update) = update.some() else {
            return;
        };
        match find_use(hir, bound, update) {
            Use::Key { object } => {
                usage.facts |= match self.is_list(object) {
                    true => Facts::INT32,
                    false => Facts::KEY,
                };
            }
            Use::ComparedWith(other) if is_int32_literal(hir, other) => usage.facts |= Facts::INT32,
            _ => {}
        }
    }

    fn add_addition(&mut self, other: ExprId, usage: &mut Usage) {
        if let Ok(ty) = self.expression_type(other)
            && self.is_number_type(ty)
        {
            usage.facts |= Facts::NUMBER_AT_EVERY_VALUE;
        }
    }

    fn add_comparison(&mut self, other: ExprId, usage: &mut Usage) {
        let Ok(ty) = self.expression_type(other) else {
            return;
        };
        if self.is_number_type(ty) {
            usage.facts |= Facts::NUMBER_AT_EVERY_VALUE;
        } else if self.is_string_type(ty) {
            usage.facts |= Facts::STRING;
        }
    }

    fn add_store(&mut self, op: Option<BinOp>, value: ExprId, usage: &mut Usage) {
        usage.facts |= Facts::STORED;
        match op {
            None | Some(BinOp::And | BinOp::Or | BinOp::Nullish) => {
                if matches!(self.hir()[value].kind, ExprKind::Object(_)) {
                    usage.facts |= Facts::OBJECT_LITERAL_STORED;
                }
                if let Ok(ty) = self.expression_type(value) {
                    let ty = self.c.widened(ty);
                    self.add_arm(usage, ty);
                }
            }
            Some(BinOp::Add) => self.add_addition(value, usage),
            Some(BinOp::Sub | BinOp::Mul | BinOp::Div | BinOp::Rem | BinOp::Pow) => {
                usage.facts |= Facts::NUMBER_AT_EVERY_VALUE;
            }
            Some(
                BinOp::Shl
                | BinOp::Shr
                | BinOp::UShr
                | BinOp::BitAnd
                | BinOp::BitOr
                | BinOp::BitXor,
            ) => usage.facts |= Facts::NUMBER_AT_EVERY_VALUE | Facts::INT32,
            Some(
                BinOp::Lt
                | BinOp::Le
                | BinOp::Gt
                | BinOp::Ge
                | BinOp::EqEq
                | BinOp::NotEq
                | BinOp::EqEqEq
                | BinOp::NotEqEq
                | BinOp::In
                | BinOp::Instanceof
                | BinOp::Comma,
            ) => {}
        }
    }

    fn add_keyed_access(
        &mut self,
        walk: &mut Walk,
        access: ExprId,
        key: ExprId,
        usage: &mut Usage,
    ) {
        let Ok(key_type) = self.expression_type(key) else {
            return;
        };
        let is_index = self.is_number_type(key_type)
            || self.c.is_any(key_type) && self.is_used_as_number(walk, key);
        if is_index {
            self.add_evidence(walk, access, usage.elements_mut());
        } else if let Some(name) = self.c.property_name_of_type(key_type) {
            if !walk.is_out_of_budget() {
                self.add_evidence(walk, access, usage.member_mut(name));
            }
        } else {
            usage.facts |= Facts::OBJECT;
        }
    }

    fn is_used_as_number(&mut self, walk: &mut Walk, expression: ExprId) -> bool {
        let Some(subject) = self.find_referenced_subject(expression) else {
            return false;
        };
        let usage = self.usage_of(walk, subject);
        usage.is_some_and(|usage| usage.is_number())
    }

    fn add_uses_of_pattern(&mut self, walk: &mut Walk, pattern: PatId, usage: &mut Usage) {
        if self.c.is_stack_low() || !walk.enter_node_of(usage) {
            return;
        }
        let hir = self.hir();
        match hir[pattern].kind {
            PatKind::Missing => {}
            PatKind::Ident(_) => self.add_uses_of_name(walk, pattern, usage),
            PatKind::Object(properties) => {
                usage.facts |= Facts::REQUIRED;
                for property in properties.iter().filter(|&property| !hir[property].is_rest) {
                    match hir.runtime_binding_key(property) {
                        PropKey::Name(name) => {
                            let member = usage.member_mut(name);
                            self.add_uses_of_pattern(walk, hir[property].value, member);
                        }
                        PropKey::Computed(_) => usage.facts |= Facts::OBJECT,
                        PropKey::None | PropKey::Private(_) => {}
                    }
                }
            }
            PatKind::Array(elements) => {
                usage.facts |= Facts::REQUIRED;
                let contents = usage.elements_mut();
                for element in elements.iter().filter(|&element| !hir[element].is_rest) {
                    self.add_uses_of_pattern(walk, hir[element].pat, contents);
                }
            }
        }
    }

    fn add_uses_of_name(&mut self, walk: &mut Walk, name: PatId, usage: &mut Usage) {
        let Ok(checked) = self.checked_binding_type(name) else {
            return;
        };
        if !self.c.is_any(checked) {
            self.add_arm(usage, checked);
            return;
        }
        let bound = self.bound();
        let Some(symbol) = find_initialized_symbol(bound, name) else {
            return;
        };
        if bound.stores_to(symbol).is_empty() && bound.symbol(symbol).decls.len() == 1 {
            self.add_uses_of_subject(walk, Subject::Binding(symbol), usage);
        }
    }

    fn checked_binding_type(&mut self, pattern: PatId) -> CheckedType {
        self.ask(|queries| {
            let ty = queries.c.type_of_pat(queries.file, pattern);
            queries.resolved(ty)
        })
    }

    fn add_members_of_assignment_pattern(&self, pattern: ExprId, usage: &mut Usage) {
        let hir = self.hir();
        let ExprKind::Object(properties) = hir[pattern].kind else {
            return;
        };
        usage.facts |= Facts::REQUIRED;
        for property in properties.iter() {
            match hir.runtime_property_key(property) {
                PropKey::Name(name) => {
                    usage.member_mut(name);
                }
                PropKey::Computed(_) => usage.facts |= Facts::OBJECT,
                PropKey::None | PropKey::Private(_) => {}
            }
        }
    }

    fn add_uses_of_argument(
        &mut self,
        walk: &mut Walk,
        call: ExprId,
        index: usize,
        usage: &mut Usage,
    ) {
        let (signature, index) = match self.find_call_with_receiver(call) {
            Some(indirect) if index == 0 => {
                self.add_uses_of_receiver(walk, indirect.signature, usage);
                return;
            }
            Some(indirect) if indirect.takes_argument_list => return,
            Some(indirect) => (indirect.signature, index - 1),
            None => match self.resolved_call(call) {
                Ok(Some(target)) => (target.signature, index),
                Ok(None) | Err(_) => return,
            },
        };
        let parameters = self.c.sig_params(signature);
        let Some(parameter) = find_parameter(&parameters, index) else {
            return;
        };
        let subject = parameter
            .declaration
            .and_then(|(of, declared)| self.find_parameter_subject(of, declared, parameter.ty));
        let Some(subject) = subject else {
            self.add_arm(usage, parameter.ty);
            return;
        };
        let number_facts = Facts::NUMBER | Facts::INT32;
        let known_here = usage.facts & number_facts;
        self.add_uses_of_subject(walk, subject, usage);
        if !usage.facts.contains(Facts::NUMBER_AT_EVERY_VALUE) {
            usage.facts = (usage.facts - number_facts) | known_here;
        }
    }

    fn add_uses_of_receiver(&mut self, walk: &mut Walk, signature: SigId, usage: &mut Usage) {
        let declaration = self.c.sig_decl(signature);
        let subject =
            declaration.and_then(|(of, function, _)| self.find_this_subject(of, function));
        if let Some(subject) = subject {
            self.add_uses_of_subject(walk, subject, usage);
        }
    }

    fn find_call_with_receiver(&mut self, call: ExprId) -> Option<CallWithReceiver> {
        let hir = self.hir();
        let ExprKind::Call(site) = hir[call].kind else {
            return None;
        };
        let (function, MemberKey::Name(name)) = hir.member_key(hir[site].callee)? else {
            return None;
        };
        let function_type = self.expression_type(function).ok()?;
        let &[signature] = &self.c.signatures(function_type, false)[..] else {
            return None;
        };
        let (method, _) = self.c.get_property_of_type(function_type, name)?;
        let forms = [(known::call, false), (known::apply, true)];
        let (_, takes_argument_list) = forms
            .into_iter()
            .find(|&(form, _)| self.is_function_method(method, form))?;
        Some(CallWithReceiver {
            signature,
            takes_argument_list,
        })
    }

    fn is_function_method(&mut self, method: &'p Prop<'p>, name: Atom) -> bool {
        [known::CallableFunction, known::Function]
            .into_iter()
            .any(|interface| {
                let functions = self.c.global_ref(interface, &[]);
                let declared = self.c.get_property_of_type(functions, name);
                declared.is_some_and(|(declared, _)| declared.source == method.source)
            })
    }

    fn type_of_usage(&mut self, usage: &Usage) -> TypeId {
        if self.c.is_stack_low() {
            return TypeId::ANY;
        }
        let mut parts = TypeParts::from_slice(&usage.arms);
        if usage.facts.contains(Facts::NUMBER) {
            parts.push(self.number_type(usage.facts));
        }
        if usage.facts.contains(Facts::STRING) {
            parts.push(TypeId::STRING);
        }
        if usage.facts.contains(Facts::FUNCTION) {
            parts.push(self.c.global_ref(known::Function, &[]));
        } else if !usage.facts.contains(Facts::INCOMPLETE) {
            self.add_object_parts(usage, &mut parts);
        }
        match parts[..] {
            [] => TypeId::ANY,
            [only] => only,
            _ => self.c.union(&parts),
        }
    }

    /// A part belongs to the trees of many subjects, and its type is worked out once. What was cut short for lack of stack, or rests on an answer that may be
    /// another next time, is not kept.
    fn type_of_part(&mut self, part: &Rc<Usage>) -> TypeId {
        if part.members.is_empty() && part.elements.is_none() {
            return self.type_of_usage(part);
        }
        if let Some(&(_, known)) = self.memo.types_of_parts.get(&Rc::as_ptr(part)) {
            return known;
        }
        let not_kept = (self.count_answers_not_kept(), self.c.times_cut_short.get());
        let ty = self.type_of_usage(part);
        if not_kept == (self.count_answers_not_kept(), self.c.times_cut_short.get()) {
            // The table holds the part, so it stays where it is and what it is: whoever adds to it copies it.
            let kept = (Rc::clone(part), ty);
            self.memo.types_of_parts.insert(Rc::as_ptr(part), kept);
        }
        ty
    }

    fn number_type(&mut self, facts: Facts) -> TypeId {
        let int32 = self.c.p.aot_symbols().int32_alias();
        match int32 {
            Some(int32) if facts.intersects(Facts::INT32 | Facts::KEY) => {
                self.c.declared_type(int32)
            }
            Some(_) | None => TypeId::NUMBER,
        }
    }

    fn add_object_parts(&mut self, usage: &Usage, parts: &mut TypeParts) {
        let elements = usage.elements.as_deref();
        if usage.facts.contains(Facts::OBJECT) && elements.is_none() {
            parts.push(TypeId::OBJECT);
            return;
        }
        let stores_object = usage.facts.contains(Facts::OBJECT_LITERAL_STORED);
        if usage.members.is_empty() && (elements.is_none() || stores_object) {
            return;
        }
        let element_type = match &usage.elements {
            Some(elements) => self.type_of_part(elements),
            None => TypeId::ANY,
        };
        let array = self.c.array_of(element_type);
        let can_be_array = !stores_object && self.has_every_member(array, &usage.members);
        let can_be_string = !stores_object
            && !usage.has_stored_part()
            && (element_type == TypeId::ANY || element_type == TypeId::STRING)
            && self.has_every_member(TypeId::STRING, &usage.members);
        let any_array = self.c.array_of(TypeId::ANY);
        if can_be_array && let Some(at) = parts.iter().position(|&part| part == any_array) {
            parts[at] = array;
            return;
        }
        let mut fitting = TypeParts::new();
        for (fits, candidate) in [(can_be_array, array), (can_be_string, TypeId::STRING)] {
            if fits && elements.is_some() {
                fitting.push(candidate);
            }
        }
        let is_decided = parts
            .iter()
            .any(|&part| fitting.contains(&part) || self.c.is_array(part));
        let function = self.c.global_ref(known::Function, &[]);
        let can_be_function = usage.members.iter().any(Member::is_called)
            && self.has_every_member(function, &usage.members);
        let can_be_builtin = can_be_array || can_be_string || can_be_function;
        match fitting[..] {
            [] if can_be_builtin => {}
            [] => {
                let known_parts = parts.clone();
                let mut known_parts = known_parts.into_iter();
                if !known_parts.any(|part| self.has_every_member(part, &usage.members)) {
                    parts.push(self.object_type_of(&usage.members));
                }
            }
            [only] => parts.push(only),
            _ if is_decided => {}
            _ => parts.extend_from_slice(&fitting),
        }
    }

    fn has_every_member(&mut self, receiver: TypeId, members: &[Member]) -> bool {
        members.iter().all(|member| {
            let found = self.c.get_property_of_type(receiver, member.name);
            found.is_some_and(|(property, _)| {
                property.flags.contains(PropFlags::METHOD) == member.is_called()
            })
        })
    }

    fn object_type_of(&mut self, members: &[Member]) -> TypeId {
        let mut props = Vec::with_capacity(members.len());
        for member in members {
            let mut flags = match member.usage.facts.contains(Facts::REQUIRED) {
                true => PropFlags::empty(),
                false => PropFlags::OPTIONAL,
            };
            if member.is_called() {
                flags |= PropFlags::METHOD;
            }
            props.push(Prop {
                name: member.name,
                flags,
                source: PropSource::Type(self.type_of_part(&member.usage)),
                mapper: MapperId::IDENTITY,
                name_type: TypeId::UNRESOLVED,
            });
        }
        let atoms = self.c.atoms();
        props.sort_unstable_by(|a, b| atoms.bytes(a.name).cmp(atoms.bytes(b.name)));
        let arena = self.c.arena;
        self.c.synth(Shape {
            props: vec_from_iter_in(props, arena),
            ..Shape::new_in(arena)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(usage: &Usage) -> Vec<Atom> {
        usage.members.iter().map(|member| member.name).collect()
    }

    #[test]
    fn references_to_one_subject_are_found_together() {
        let references = [
            (SymbolId(1), ExprId(4)),
            (SymbolId(3), ExprId(2)),
            (SymbolId(3), ExprId(9)),
            (SymbolId(7), ExprId(1)),
        ];
        assert_eq!(references_to(&references, SymbolId(3)), &references[1..3]);
        assert!(references_to(&references, SymbolId(2)).is_empty());
        assert!(references_to(&references, SymbolId(8)).is_empty());
    }

    #[test]
    fn only_a_subject_that_started_earlier_taints() {
        let mut subjects = SubjectStack::default();
        let outer = subjects.enter();
        let inner = subjects.enter();
        subjects.revisit(inner.depth);
        assert!(!subjects.leave(inner));
        let inner = subjects.enter();
        let innermost = subjects.enter();
        subjects.revisit(outer.depth);
        assert!(subjects.leave(innermost));
        assert!(subjects.leave(inner));
        assert!(!subjects.leave(outer));
        assert_eq!(subjects.depth, 0);
    }

    #[test]
    fn a_later_subject_does_not_inherit_an_earlier_revisit() {
        let mut subjects = SubjectStack::default();
        let outer = subjects.enter();
        let middle = subjects.enter();
        subjects.revisit(outer.depth);
        let clean = subjects.enter();
        assert!(!subjects.leave(clean));
        assert!(subjects.leave(middle));
        assert!(!subjects.leave(outer));
    }

    #[test]
    fn walk_ends_with_its_budget() {
        let mut walk = Walk::new(2);
        assert!(walk.enter_node());
        assert!(!walk.is_out_of_budget());
        assert!(walk.enter_node());
        assert!(walk.is_out_of_budget());
        assert!(!walk.enter_node());
    }

    #[test]
    fn merge_keeps_the_order_of_first_use() {
        let mut usage = Usage::default();
        usage.member_mut(known::length).facts |= Facts::NUMBER;
        let mut other = Usage::default();
        other.member_mut(known::call).facts |= Facts::FUNCTION;
        other.member_mut(known::length).facts |= Facts::REQUIRED;
        other.elements_mut().add_arm(TypeId::STRING);
        usage.merge(&mut Walk::new(16), &other);
        assert_eq!(names(&usage), [known::length, known::call]);
        assert_eq!(
            usage.members[0].usage.facts,
            Facts::NUMBER | Facts::REQUIRED
        );
        assert_eq!(usage.elements_mut().arms[..], [TypeId::STRING]);
    }

    #[test]
    fn merge_stops_without_budget() {
        let mut other = Usage::default();
        other.member_mut(known::length);
        other.member_mut(known::call);
        let mut usage = Usage::default();
        usage.merge(&mut Walk::new(2), &other);
        assert_eq!(names(&usage), [known::length, known::call]);
        assert!(usage.members[1].usage.facts.is_empty());
        let mut walk = Walk::new(0);
        let mut untouched = Usage::default();
        untouched.merge(&mut walk, &other);
        assert!(untouched.members.is_empty());
    }

    #[test]
    fn only_the_right_side_of_in_and_of_a_comma_says_something() {
        let (whole, other) = (ExprId(1), ExprId(2));
        let find = |op, side| find_use_as_binary_operand(op, whole, side, other);
        assert!(matches!(find(BinOp::In, Side::Left), Use::Nothing));
        assert!(matches!(
            find(BinOp::In, Side::Right),
            Use::Object { is_required: true }
        ));
        assert!(matches!(find(BinOp::Comma, Side::Left), Use::Nothing));
        assert!(matches!(
            find(BinOp::Comma, Side::Right),
            Use::PassedOn(ExprId(1))
        ));
    }

    #[test]
    fn int32_values_are_whole_and_in_range() {
        for value in [0.0, -1.0, 7.0, 2147483647.0, -2147483648.0] {
            assert!(is_int32_value(value), "{value}");
        }
        for value in [
            0.5,
            -0.0,
            2147483648.0,
            -2147483649.0,
            f64::NAN,
            f64::INFINITY,
        ] {
            assert!(!is_int32_value(value), "{value}");
        }
    }

    #[test]
    fn an_unsigned_shift_and_a_sum_may_leave_int32() {
        for op in [
            BinOp::Shl,
            BinOp::Shr,
            BinOp::BitAnd,
            BinOp::BitOr,
            BinOp::BitXor,
        ] {
            assert!(yields_int32(op), "{op:?}");
        }
        for op in [BinOp::UShr, BinOp::Add, BinOp::Sub, BinOp::Mul, BinOp::Rem] {
            assert!(!yields_int32(op), "{op:?}");
        }
    }

    #[test]
    fn a_stored_part_is_an_element_or_a_member() {
        let mut usage = Usage::default();
        usage.member_mut(known::length);
        assert!(!usage.has_stored_part());
        usage.facts |= Facts::STORED;
        assert!(!usage.has_stored_part());
        usage.elements_mut().facts |= Facts::STORED;
        assert!(usage.has_stored_part());
    }
}
