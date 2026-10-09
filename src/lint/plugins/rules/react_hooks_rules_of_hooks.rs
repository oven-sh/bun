use crate::oxlint::{self, rules_of_hooks::Flow};
use bun_core::strings;
use bun_lint::code_path::{Event, Step, steps};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::source::ByName;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use rustc_hash::{FxHashMap, FxHashSet};
use std::cell::OnceCell;
use std::collections::BinaryHeap;

/// Enforces the Rules of Hooks.
pub struct RulesOfHooks;

const TRY_CATCH: Message = Message::new("", "React Hook \"{{hook}}\" cannot be called in a try/catch block.");
const LOOP: Message = Message::new(
    "",
    "React Hook \"{{hook}}\" may be executed more than once. Possibly because it is called in a loop. React Hooks must be called in the exact same order in every component render.",
);
const ASYNC: Message = Message::new("", "React Hook \"{{hook}}\" cannot be called in an async function.");
const CONDITIONAL: Message = Message::new(
    "",
    "React Hook \"{{hook}}\" is called conditionally. React Hooks must be called in the exact same order in every component render.{{hint}}",
);
const CLASS: Message = Message::new(
    "",
    "React Hook \"{{hook}}\" cannot be called in a class component. React Hooks must be called in a React function component or a custom React Hook function.",
);
const FUNCTION: Message = Message::new(
    "",
    "React Hook \"{{hook}}\" is called in function \"{{function}}\" that is neither a React function component nor a custom React Hook function. React component names must start with an uppercase letter. React Hook names must start with the word \"use\".",
);
const TOP_LEVEL: Message = Message::new(
    "",
    "React Hook \"{{hook}}\" cannot be called at the top level. React Hooks must be called in a React function component or a custom React Hook function.",
);
const CALLBACK: Message = Message::new(
    "",
    "React Hook \"{{hook}}\" cannot be called inside a callback. React Hooks must be called in a React function component or a custom React Hook function.",
);
const EFFECT_EVENT_PASSED_DOWN: Message = Message::new(
    "",
    "React Hook \"useEffectEvent\" can only be called at the top level of your component. It cannot be passed down.",
);
const EFFECT_EVENT_FUNCTION: Message = Message::new(
    "",
    "`{{function}}` is a function created with React Hook \"useEffectEvent\", and can only be called from Effects and Effect Events in the same component.{{hint}}",
);

/// `use`, or `use` and then an uppercase Latin letter or a digit, which leaves out `user`.
pub(crate) fn is_hook_name(name: &[u8]) -> bool {
    match name.strip_prefix(b"use") {
        Some([]) => true,
        Some([next, ..]) => next.is_ascii_uppercase() || next.is_ascii_digit(),
        None => false,
    }
}

fn starts_with_uppercase(name: Name) -> bool {
    name.bytes().first().is_some_and(u8::is_ascii_uppercase)
}

/// `useState`, `React.useState`: the name of a hook, which can be a member of what is named in Pascal case.
fn is_hook(e: Expr) -> bool {
    match e.kind() {
        ExprKind::Ident(name) => is_hook_name(name.bytes()),
        ExprKind::Dot { obj, name, .. } => is_hook_name(name.bytes()) && obj.as_ident().is_some_and(starts_with_uppercase),
        _ => false,
    }
}

/// `name`, `React.name`
fn is_react_function(e: Expr, function: &str) -> bool {
    match e.kind() {
        ExprKind::Ident(name) => name.is(function),
        ExprKind::Dot { obj, name, .. } => obj.is_ident("React") && name.name().is(function),
        ExprKind::Index { obj, index, .. } => obj.is_ident("React") && index.is_ident(function),
        _ => false,
    }
}

/// `isForwardRefCallback(node) || isMemoCallback(node)`
fn is_forward_ref_or_memo_callback(e: Expr) -> bool {
    match e.parent() {
        Node::Expr(parent) if !e.is_chain_root() => match parent.kind() {
            ExprKind::Call(call) | ExprKind::New(call) => {
                is_react_function(call.callee(), "forwardRef") || is_react_function(call.callee(), "memo")
            }
            _ => false,
        },
        _ => false,
    }
}

/// What `getFunctionName` returns.
#[derive(Copy, Clone)]
enum FunctionName<'a> {
    Ident(Name<'a>, Span),
    Expr(Expr<'a>),
    /// A pattern, or a key that is a string or a number.
    Other(Span),
}

impl<'a> FunctionName<'a> {
    fn of_pattern(pat: Pat<'a>, span: Span) -> FunctionName<'a> {
        match pat.as_ident() {
            Some(name) => FunctionName::Ident(name, span),
            None => FunctionName::Other(span),
        }
    }

    fn span(self) -> Span {
        match self {
            FunctionName::Ident(_, span) | FunctionName::Other(span) => span,
            FunctionName::Expr(e) => e.span(),
        }
    }

    /// `isComponentName(name) || isHook(name)`
    fn is_component_or_hook(self) -> bool {
        match self {
            FunctionName::Ident(name, _) => starts_with_uppercase(name) || is_hook_name(name.bytes()),
            FunctionName::Expr(e) => match e.kind() {
                ExprKind::Ident(name) => starts_with_uppercase(name) || is_hook_name(name.bytes()),
                _ => is_hook(e),
            },
            FunctionName::Other(_) => false,
        }
    }
}

/// The name that JavaScript gives the function, roughly.
fn get_function_name(func: Func) -> Option<FunctionName> {
    if let Some(name) = func.name()
        && matches!(func.kind(), FnKind::Decl | FnKind::Expr)
    {
        return Some(FunctionName::Ident(name.name(), name.span()));
    }
    let Node::Expr(e) = func.owner() else {
        return None;
    };
    match e.parent() {
        Node::VarDecl(declarator) => Some(FunctionName::of_pattern(declarator.pat(), declarator.binding_span())),
        Node::Expr(parent) => match parent.kind() {
            ExprKind::Assign {
                op: None,
                target,
                value,
            } if value == e => Some(FunctionName::Expr(target)),
            _ => None,
        },
        Node::Prop(prop) if !prop.is_jsx_attribute() && prop.value() == Some(e) => {
            let key = prop.key()?;
            match key.kind() {
                KeyKind::Ident(name) => Some(FunctionName::Ident(name, key.span(e.file()))),
                KeyKind::String(_) | KeyKind::Number(_) => Some(FunctionName::Other(key.span(e.file()))),
                _ => None,
            }
        }
        Node::Param(param) => Some(FunctionName::of_pattern(param.pat(), param.binding_span())),
        Node::PatElem(element) => element.pat().map(|pat| FunctionName::of_pattern(pat, pat.span())),
        Node::PatProp(prop) if prop.default() == Some(e) => Some(FunctionName::of_pattern(prop.value(), prop.value().span())),
        _ => None,
    }
}

fn is_inside_component_or_hook<'a>(node: Node<'a>, known: &mut AncestorMemo<'a, ()>) -> bool {
    let is_one = |it: Node<'a>| match it {
        Node::Func(func) => get_function_name(func).is_some_and(FunctionName::is_component_or_hook),
        Node::Expr(e) => is_forward_ref_or_memo_callback(e),
        _ => false,
    };
    known.find(node, |it, _| is_one(it).then_some(())).is_some()
}

/// Ranges of the text, to ask in how many of them a position is.
pub(crate) struct Ranges {
    /// Sorted.
    starts: Vec<u32>,
    /// Sorted.
    ends: Vec<u32>,
}

impl Ranges {
    pub(crate) fn new(ranges: impl Iterator<Item = Span>) -> Ranges {
        let (mut starts, mut ends): (Vec<u32>, Vec<u32>) = ranges.map(|it| (it.start, it.end)).unzip();
        starts.sort_unstable();
        ends.sort_unstable();
        Ranges { starts, ends }
    }

    pub(crate) fn count_around(&self, at: u32) -> usize {
        self.starts.partition_point(|it| *it <= at).saturating_sub(self.ends.partition_point(|it| *it <= at))
    }

    pub(crate) fn contains(&self, at: u32) -> bool {
        self.count_around(at) != 0
    }
}

/// What is asked about every hook, and computed once for the file.
#[derive(Default)]
pub(crate) struct Memo<'a> {
    do_while_loops: OnceCell<Ranges>,
    try_statements: OnceCell<Ranges>,
    /// For oxlint: the calls in which a function that `useEffectEvent` returns can be referred to.
    pub(crate) effects: OnceCell<Ranges>,
    /// The lines after those on which a comment `$FlowFixMe[react-rule-hook]` ends, sorted.
    suppressed_lines: OnceCell<Vec<u32>>,
    /// Whether something is a component or a hook, or in one.
    pub(crate) inside_component_or_hook: AncestorMemo<'a, ()>,
    /// For oxlint: the function around something,
    pub(crate) function_around: AncestorMemo<'a, Func<'a>>,
    /// and whether it is in a call of `memo` or `forwardRef`.
    pub(crate) in_memo_or_forward_ref: AncestorMemo<'a, ()>,
}

impl<'a> Memo<'a> {
    pub(crate) fn do_while_loops(&self, file: &'a File<'a>) -> &Ranges {
        self.do_while_loops.get_or_init(|| Ranges::new(file.stmts_of_kind(StmtTag::DoWhile).map(Stmt::span)))
    }

    pub(crate) fn try_statements(&self, file: &'a File<'a>) -> &Ranges {
        self.try_statements.get_or_init(|| Ranges::new(file.stmts_of_kind(StmtTag::Try).map(Stmt::span)))
    }

    fn is_inside_do_while_loop(&self, e: Expr<'a>) -> bool {
        self.do_while_loops(e.file()).contains(e.span().start)
    }

    fn is_inside_try_catch(&self, e: Expr<'a>) -> bool {
        self.try_statements(e.file()).contains(e.span().start)
    }

    /// A comment `$FlowFixMe[react-rule-hook]` ends on the line before.
    fn has_flow_suppression(&self, hook: Expr<'a>) -> bool {
        const SUPPRESSION: &[u8] = b"$FlowFixMe[react-rule-hook]";
        let file = hook.file();
        let lines = self.suppressed_lines.get_or_init(|| {
            if !strings::contains(file.text(), SUPPRESSION) {
                return Vec::new();
            }
            let comments = file.comments().filter(|it| strings::contains(it.value(), SUPPRESSION));
            let mut lines: Vec<u32> = comments.map(|it| file.line_of(it.end()) + 1).collect();
            lines.sort_unstable();
            lines
        });
        !lines.is_empty() && lines.binary_search(&file.line_of(hook.span().start)).is_ok()
    }
}

/// The `useEffect` of `React.useEffect`.
fn name_without_react_namespace(callee: Expr) -> Option<Name> {
    match callee.kind() {
        ExprKind::Ident(name) => Some(name),
        ExprKind::Dot { obj, name, .. } if obj.is_ident("React") && !name.bytes().starts_with(b"#") => Some(name.name()),
        _ => None,
    }
}

/// The number of routes through a part of a code path, which doubles with every `if`. It is only compared, with 0 and with another:
/// so it is kept modulo a prime.
#[derive(Copy, Clone, PartialEq, Eq)]
struct Count {
    residue: u64,
    is_zero: bool,
}

impl Count {
    const MODULUS: u64 = (1 << 61) - 1;
    const ZERO: Count = Count {
        residue: 0,
        is_zero: true,
    };
    const ONE: Count = Count {
        residue: 1,
        is_zero: false,
    };

    fn plus(self, other: Count) -> Count {
        Count {
            residue: (self.residue + other.residue) % Count::MODULUS,
            is_zero: self.is_zero && other.is_zero,
        }
    }

    fn times(self, other: Count) -> Count {
        Count {
            residue: (u128::from(self.residue) * u128::from(other.residue) % u128::from(Count::MODULUS)) as u64,
            is_zero: self.is_zero || other.is_zero,
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Direction {
    FromStart,
    ToEnd,
}

/// What is computed about the segments of one code path that has calls of hooks.
struct Paths<'a> {
    /// The ids of the segments that end with a `throw`.
    thrown: FxHashSet<u32>,
    /// The ids of the segments that are in a cycle.
    cyclic: FxHashSet<u32>,
    from_start: FxHashMap<u32, Count>,
    to_end: FxHashMap<u32, Count>,
    /// `None` while it is computed.
    shortest: FxHashMap<u32, Option<u32>>,
    /// A call that cannot be reached is counted for the segment of the code path around that the function is in. Upstream looks at
    /// that while it is analyzed, when it leads nowhere yet and nothing made later leads to it.
    outer: Option<Segment<'a>>,
}

/// The segments whose count from the start has come out as zero while one segment is asked for.
///
/// Upstream keeps no count that is zero, and counts anew each time: in a loop that takes twice as long with every `if`. A count is zero
/// because all routes from the start to the segment lead through segments of the stack. Until the topmost of these leaves the stack it
/// comes out as zero again, and counting it again finds nothing new to be in a cycle but the frames of the stack above the lowest of
/// them. When the topmost leaves the stack with zero itself, the same holds with the segments that made it zero: its group takes over
/// those that it owns.
#[derive(Default)]
struct Zeros {
    /// The group of each segment, by its id.
    group_of: FxHashMap<u32, usize>,
    groups: Vec<ZeroGroup>,
}

struct ZeroGroup {
    /// The group that has taken it over, or itself.
    parent: usize,
    /// `Frame::cyclic_from` of the frame that it was made for.
    cyclic_from: usize,
    /// Where in the stack the frame is that owns it.
    owner: usize,
    is_valid: bool,
}

impl Zeros {
    fn find(&mut self, group: usize) -> usize {
        let mut root = group;
        while let Some(parent) = self.groups.get(root).map(|it| it.parent).filter(|it| *it != root) {
            root = parent;
        }
        let mut at = group;
        while let Some(it) = self.groups.get_mut(at).filter(|it| it.parent != root) {
            at = std::mem::replace(&mut it.parent, root);
        }
        root
    }

    /// `cyclic_from` and `owner` of the group of `segment`, if its count is still known to be zero.
    fn get(&mut self, segment: u32) -> Option<(usize, usize)> {
        let group = *self.group_of.get(&segment)?;
        let root = self.find(group);
        self.groups.get(root).filter(|it| it.is_valid).map(|it| (it.cyclic_from, it.owner))
    }

    /// Makes a group for `segment`, which takes over the groups `owned`.
    fn add(&mut self, segment: u32, cyclic_from: usize, owner: usize, owned: &[usize]) -> usize {
        let group = self.groups.len();
        self.groups.push(ZeroGroup {
            parent: group,
            cyclic_from,
            owner,
            is_valid: true,
        });
        for &it in owned {
            let root = self.find(it);
            if let Some(root) = self.groups.get_mut(root) {
                root.parent = group;
            }
        }
        self.group_of.insert(segment, group);
        group
    }

    /// The frame that owns the groups `owned` has left the stack with a count that is not zero.
    fn forget(&mut self, owned: &[usize]) {
        for &it in owned {
            let root = self.find(it);
            if let Some(root) = self.groups.get_mut(root) {
                root.is_valid = false;
            }
        }
    }
}

type Segments<'a> = bun_lint::code_path::Segments<'a>;

const INFINITY: u32 = u32::MAX;

impl<'a> Paths<'a> {
    fn neighbors(&self, segment: Segment<'a>, direction: Direction) -> Segments<'a> {
        let mut all = match direction {
            Direction::FromStart => segment.prev_segments(),
            Direction::ToEnd => segment.next_segments(),
        };
        if let Some(outer) = self.outer.filter(|outer| outer.code_path() == segment.code_path()) {
            all.retain(|it| it.id() <= outer.id() && (direction == Direction::FromStart || segment != outer));
        }
        all
    }

    /// `countPathsFromStart` and `countPathsToEnd`, which also find the segments that are in a cycle.
    fn count(&mut self, start: Segment<'a>, direction: Direction) -> Count {
        struct Frame<'a> {
            segment: Segment<'a>,
            neighbors: Segments<'a>,
            next: usize,
            sum: Count,
            /// The frames from this position in the stack up to this one are in a cycle.
            cyclic_from: usize,
            /// Where in the stack the segments are that the routes from here have led back to. Only from the start.
            met: BinaryHeap<usize>,
            /// The groups of `zeros` that are zero as long as this frame is in the stack.
            owned: Vec<usize>,
        }
        let mut stack: Vec<Frame<'a>> = Vec::new();
        // Where each segment of the stack is in it.
        let mut positions: FxHashMap<u32, usize> = FxHashMap::default();
        let mut zeros = Zeros::default();
        let mut entering = Some(start);
        let mut returned = Count::ZERO;
        loop {
            if let Some(segment) = entering.take() {
                let cache = match direction {
                    Direction::FromStart => &self.from_start,
                    Direction::ToEnd => &self.to_end,
                };
                if let Some(&at) = positions.get(&segment.id()) {
                    if let Some(top) = stack.last_mut() {
                        top.cyclic_from = top.cyclic_from.min(at + 1);
                        if direction == Direction::FromStart {
                            top.met.push(at);
                        }
                    }
                    returned = Count::ZERO;
                } else if let Some(&cached) = cache.get(&segment.id()) {
                    returned = cached;
                } else if let Some((cyclic_from, owner)) = zeros.get(segment.id()) {
                    if let Some(top) = stack.last_mut() {
                        top.cyclic_from = top.cyclic_from.min(cyclic_from);
                        top.met.push(owner);
                    }
                    returned = Count::ZERO;
                } else {
                    let is_thrown = self.thrown.contains(&segment.id());
                    let neighbors = if is_thrown { Segments::new() } else { self.neighbors(segment, direction) };
                    positions.insert(segment.id(), stack.len());
                    stack.push(Frame {
                        segment,
                        sum: if is_thrown || !neighbors.is_empty() { Count::ZERO } else { Count::ONE },
                        neighbors,
                        next: 0,
                        cyclic_from: usize::MAX,
                        met: BinaryHeap::new(),
                        owned: Vec::new(),
                    });
                    returned = Count::ZERO;
                }
            }
            let Some(top) = stack.last_mut() else {
                return returned;
            };
            top.sum = top.sum.plus(returned);
            returned = Count::ZERO;
            if let Some(&neighbor) = top.neighbors.get(top.next) {
                top.next += 1;
                entering = Some(neighbor);
                continue;
            }
            let Some(mut top) = stack.pop() else {
                return returned;
            };
            let (segment, sum, position) = (top.segment, top.sum, stack.len());
            positions.remove(&segment.id());
            if top.cyclic_from <= position {
                self.cyclic.insert(segment.id());
                if let Some(below) = stack.last_mut() {
                    below.cyclic_from = below.cyclic_from.min(top.cyclic_from);
                }
            }
            match direction {
                Direction::FromStart => {
                    while top.met.peek().is_some_and(|it| *it >= position) {
                        top.met.pop();
                    }
                    // There is a route from the start to a segment that can be reached: it was asked from inside a cycle.
                    if segment.is_reachable() && sum.is_zero {
                        self.from_start.remove(&segment.id());
                        match top.met.peek() {
                            Some(&owner) => {
                                let group = zeros.add(segment.id(), top.cyclic_from, owner, &top.owned);
                                if let Some(frame) = stack.get_mut(owner) {
                                    frame.owned.push(group);
                                }
                            }
                            None => zeros.forget(&top.owned),
                        }
                    } else {
                        self.from_start.insert(segment.id(), sum);
                        zeros.forget(&top.owned);
                    }
                    if let Some(below) = stack.last_mut() {
                        below.met.append(&mut top.met);
                    }
                }
                Direction::ToEnd => {
                    self.to_end.insert(segment.id(), sum);
                }
            }
            if stack.is_empty() {
                return sum;
            }
            returned = sum;
        }
    }

    /// `shortestPathLengthToStart`
    fn shortest_path_length_to_start(&mut self, start: Segment<'a>) -> u32 {
        struct Frame<'a> {
            segment: Segment<'a>,
            prev: Segments<'a>,
            next: usize,
            length: u32,
        }
        let mut stack: Vec<Frame<'a>> = Vec::new();
        let mut entering = Some(start);
        let mut returned = INFINITY;
        loop {
            if let Some(segment) = entering.take() {
                match self.shortest.get(&segment.id()) {
                    Some(None) => returned = INFINITY,
                    Some(&Some(length)) => returned = length,
                    None => {
                        self.shortest.insert(segment.id(), None);
                        stack.push(Frame {
                            segment,
                            prev: self.neighbors(segment, Direction::FromStart),
                            next: 0,
                            length: INFINITY,
                        });
                        returned = INFINITY;
                    }
                }
            }
            let Some(top) = stack.last_mut() else {
                return returned;
            };
            top.length = top.length.min(returned);
            returned = INFINITY;
            if let Some(&prev) = top.prev.get(top.next) {
                top.next += 1;
                entering = Some(prev);
                continue;
            }
            let length = if top.prev.is_empty() { 1 } else { top.length.saturating_add(1) };
            self.shortest.insert(top.segment.id(), Some(length));
            stack.pop();
            if stack.is_empty() {
                return length;
            }
            returned = length;
        }
    }
}

#[derive(Default)]
pub struct State<'a> {
    /// The calls of hooks.
    calls: Vec<Expr<'a>>,
    /// The segments that have started and not ended, of all code paths. Only those that can be reached.
    segments: Vec<Segment<'a>>,
    /// The callees that are hooks, with the segment that each is in, of the code paths that have not ended.
    hooks: Vec<(Option<Segment<'a>>, Expr<'a>)>,
    /// Where those of each code path start in `hooks`.
    starts: Vec<usize>,
}

impl Rule for RulesOfHooks {
    const META: Meta = Meta::plugin(Plugin::ReactHooks, "rules-of-hooks", Kind::Problem).recommended();
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        RulesOfHooks
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> State<'a> {
        let mut state = State::default();
        // A file has many times as many calls as names.
        let mut is_name_of_hook = ByName::default();
        let may_call_a_hook = file.mentions_name_of_hook();
        for e in file.exprs_of_kind(ExprTag::Call).filter(|_| may_call_a_hook) {
            let Some(callee) = e.as_call().map(Call::callee) else {
                continue;
            };
            let Some(name) = callee.as_ident().or_else(|| callee.member_name().map(|it| it.name())) else {
                continue;
            };
            if is_name_of_hook.get_or_insert_with(name, || is_hook_name(name.bytes())) && is_hook(callee) {
                state.calls.push(e);
            }
        }
        if !state.calls.is_empty() {
            on.finish(Self::check);
        }
        if file.mentions("useEffectEvent") && !oxlint::is_followed(file) {
            on.finish(Self::check_effect_events);
        }
        state
    }
}

/// A call in a statement at the top of a code path, in a part of it that is always evaluated.
struct AtTheTop<'a> {
    /// What the code path starts with.
    root: Node<'a>,
    /// From where the code path starts to the statement. Empty in the body of an arrow function that is an expression.
    before: Span,
}

/// `steps`: how many more levels can be looked at.
fn at_the_top_of_its_code_path<'a>(call: Expr<'a>, steps: &mut usize) -> Option<AtTheTop<'a>> {
    let mut child = call;
    let statement = loop {
        *steps = steps.checked_sub(1)?;
        if child.is_in_optional_chain() {
            return None;
        }
        match child.parent() {
            Node::Expr(parent) => {
                let is_always_evaluated = match parent.kind() {
                    ExprKind::Call(_)
                    | ExprKind::New(_)
                    | ExprKind::Dot { .. }
                    | ExprKind::Index { .. }
                    | ExprKind::As { .. }
                    | ExprKind::AsConst(_)
                    | ExprKind::Satisfies { .. }
                    | ExprKind::NonNull(_)
                    | ExprKind::Array(_)
                    | ExprKind::Spread(_)
                    | ExprKind::Unary { .. }
                    | ExprKind::Await(_) => !parent.is_assignment_target(),
                    ExprKind::Binary { op, left, .. } => !matches!(op, BinOp::And | BinOp::Or | BinOp::Nullish) || left == child,
                    ExprKind::Cond { test, .. } => test == child,
                    ExprKind::Assign { op: None, value, .. } => value == child && !parent.is_assignment_target(),
                    _ => false,
                };
                if !is_always_evaluated {
                    return None;
                }
                child = parent;
            }
            Node::VarDecl(declarator) if declarator.init() == Some(child) => match declarator.parent() {
                Node::Stmt(statement) if !statement.is_wrapper() => break statement,
                _ => return None,
            },
            Node::Stmt(statement) if matches!(statement.tag(), StmtTag::Expr | StmtTag::Return) && !statement.is_wrapper() => break statement,
            // The body of an arrow function.
            Node::Func(func) => {
                return Some(AtTheTop {
                    root: Node::Func(func),
                    before: Span::empty(0),
                });
            }
            _ => return None,
        }
    };
    let root = statement.parent();
    let start = match root {
        Node::Func(func) if func.kind() != FnKind::StaticBlock => func.body_span()?.start,
        Node::File(_) => 0,
        _ => return None,
    };
    Some(AtTheTop {
        root,
        before: Span::new(start, statement.span().start),
    })
}

/// What the code path that each of `calls` is in starts with, if the syntax tells that every way through it leads through the call
/// once: the call is at the top of the code path, and nothing before can end the code path or go on forever. That holds for nearly
/// every call of a hook, and saves the analysis of the file. It gives up where the code is nested so deeply that the analysis costs
/// less: it takes time in proportion to the number of calls and of statements.
fn roots_if_always_called<'a>(file: &'a File<'a>, calls: &[Expr<'a>]) -> Option<Vec<Node<'a>>> {
    const STEPS_FOR_EACH: usize = 32;
    let mut steps = STEPS_FOR_EACH * (calls.len() + 8);
    let calls: Vec<AtTheTop<'a>> = calls.iter().map(|it| at_the_top_of_its_code_path(*it, &mut steps)).collect::<Option<_>>()?;
    // For each code path, where the last of the statements starts.
    let mut last: FxHashMap<Node<'a>, u32> = FxHashMap::default();
    for call in &calls {
        let last = last.entry(call.root).or_insert(0);
        *last = call.before.end.max(*last);
    }
    for (root, before) in &last {
        if let Node::Func(func) = root
            && func.returns().any(|it| it.span().start < *before)
        {
            return None;
        }
    }
    let before = Ranges::new(calls.iter().map(|it| it.before));
    let ends_or_repeats = [StmtTag::Throw, StmtTag::For, StmtTag::While, StmtTag::DoWhile];
    let earlier = ends_or_repeats.into_iter().flat_map(|tag| file.stmts_of_kind(tag)).filter(|it| before.contains(it.span().start));
    for statement in earlier {
        steps += STEPS_FOR_EACH;
        let mut around = Node::Stmt(statement).ancestors();
        let root = loop {
            steps = steps.checked_sub(1)?;
            match around.next() {
                Some(it) if !bun_lint::code_path::starts_code_path(it) => {}
                root => break root,
            }
        };
        if root.and_then(|root| last.get(&root)).is_some_and(|before| statement.span().start < *before) {
            return None;
        }
    }
    Some(calls.iter().map(|it| it.root).collect())
}

impl RulesOfHooks {
    fn check<'a>(&self, cx: &mut Cx<'a, Self>) {
        let calls = std::mem::take(&mut cx.state.calls);
        let Some(roots) = roots_if_always_called(cx.file(), &calls) else {
            return self.analyze(cx);
        };
        let mut memo = Memo::default();
        for (call, root) in calls.iter().zip(roots) {
            if let Some(call) = call.as_call() {
                self.check_hooks(root, &[(None, call.callee())], None, &mut memo, cx);
            }
        }
    }

    /// Analyzes the file, and does what upstream does in its listeners.
    fn analyze<'a>(&self, cx: &mut Cx<'a, Self>) {
        let mut memo = Memo::default();
        for step in steps(cx.file(), ExprTag::Call.into(), NodeTags::EMPTY) {
            match step {
                Step::Event(Event::SegmentStart(segment, _)) => cx.state.segments.push(segment),
                Step::Event(Event::SegmentEnd(..)) => drop(cx.state.segments.pop()),
                Step::Event(Event::CodePathStart(..)) => cx.state.starts.push(cx.state.hooks.len()),
                Step::Event(Event::CodePathEnd(code_path, node)) => {
                    let start = cx.state.starts.pop().unwrap_or(0);
                    if cx.state.hooks.len() > start {
                        let hooks = cx.state.hooks.split_off(start);
                        self.check_hooks(node, &hooks, Some(code_path), &mut memo, cx);
                    }
                }
                Step::Enter(Node::Expr(e)) => {
                    if let Some(call) = e.as_call()
                        && is_hook(call.callee())
                    {
                        let segment = cx.state.segments.last().copied();
                        cx.state.hooks.push((segment, call.callee()));
                    }
                }
                _ => {}
            }
        }
    }

    /// `node`: what the code path starts with. `code_path`: `None` if every way through it leads through each of `hooks` once.
    fn check_hooks<'a>(
        &self,
        node: Node<'a>,
        hooks: &[(Option<Segment<'a>>, Expr<'a>)],
        code_path: Option<CodePath<'a>>,
        memo: &mut Memo<'a>,
        cx: &Cx<'a, Self>,
    ) {
        // The routes, how many lead from the start to the end, and the length of the shortest.
        let mut analyzed = code_path.map(|code_path| {
            let mut paths = Paths {
                thrown: code_path.thrown_segments().iter().map(|it| it.id()).collect(),
                cyclic: FxHashSet::default(),
                from_start: FxHashMap::default(),
                to_end: FxHashMap::default(),
                shortest: FxHashMap::default(),
                outer: hooks.iter().find_map(|it| it.0.filter(|segment| segment.code_path() != code_path)),
            };
            let all_paths_from_start_to_end = paths.count(code_path.initial_segment(), Direction::ToEnd);
            let mut shortest_final_path_length = INFINITY;
            for segment in code_path.final_segments() {
                if segment.is_reachable() {
                    shortest_final_path_length = shortest_final_path_length.min(paths.shortest_path_length_to_start(segment));
                }
            }
            (paths, all_paths_from_start_to_end, shortest_final_path_length)
        });

        let func = node.as_func();
        let function_name = func.and_then(get_function_name);
        let follows_oxlint = oxlint::is_followed(cx.file());
        let is_somewhere_inside_component_or_hook = !follows_oxlint && is_inside_component_or_hook(node, &mut memo.inside_component_or_hook);
        let function_expr = match (node, func.map(Func::owner)) {
            (Node::Expr(e), _) | (_, Some(Node::Expr(e))) => Some(e),
            _ => None,
        };
        let is_directly_inside_component_or_hook = match function_name {
            Some(name) => name.is_component_or_hook(),
            None => function_expr.is_some_and(is_forward_ref_or_memo_callback),
        };
        // It is the value of a method or of a property of a class.
        let is_in_class = match (func.map(Func::owner), function_expr.map(Expr::parent)) {
            (Some(Node::Member(member)), _) => member.kind() != MemberKind::StaticBlock,
            (_, Some(Node::Member(member))) => member.init() == function_expr && !member.flags().contains(Flags::ACCESSOR),
            _ => false,
        };

        for &(segment, hook) in hooks {
            let mut possibly_has_early_return = false;
            let mut flow = Flow {
                is_reachable: true,
                is_cyclic: false,
                is_conditional: false,
            };
            if let Some((paths, all_paths_from_start_to_end, shortest_final_path_length)) = &mut analyzed {
                flow.is_reachable = false;
                if let Some(segment) = segment.filter(|it| it.is_reachable()) {
                    let length = paths.shortest_path_length_to_start(segment);
                    possibly_has_early_return = match paths.neighbors(segment, Direction::ToEnd).is_empty() {
                        true => *shortest_final_path_length <= length,
                        false => *shortest_final_path_length < length,
                    };
                    let paths_from_start_to_end =
                        paths.count(segment, Direction::FromStart).times(paths.count(segment, Direction::ToEnd));
                    flow = Flow {
                        is_reachable: true,
                        is_cyclic: paths.cyclic.contains(&segment.id()),
                        is_conditional: paths_from_start_to_end != *all_paths_from_start_to_end,
                    };
                }
            }
            if follows_oxlint {
                if let Node::Expr(call) = hook.parent() {
                    oxlint::rules_of_hooks::check(cx, call, node, flow, memo);
                }
                continue;
            }
            if !flow.is_reachable {
                continue;
            }
            let is_cycled = flow.is_cyclic;
            let is_use = is_react_function(hook, "use");
            let report = |message: Message| cx.report(hook, message).data("hook", hook.text());
            let mut reports: smallvec::SmallVec<[Message; 2]> = smallvec::SmallVec::new();

            if is_use && memo.is_inside_try_catch(hook) {
                reports.push(TRY_CATCH);
            }
            if !is_use && (is_cycled || memo.is_inside_do_while_loop(hook)) {
                reports.push(LOOP);
            }
            if is_directly_inside_component_or_hook {
                if func.is_some_and(Func::is_async) {
                    reports.push(ASYNC);
                }
                if !is_cycled
                    && flow.is_conditional
                    && !is_use
                    && !memo.is_inside_do_while_loop(hook)
                {
                    reports.push(CONDITIONAL);
                }
            } else if is_in_class {
                reports.push(CLASS);
            } else if function_name.is_some() {
                reports.push(FUNCTION);
            } else if matches!(node, Node::File(_)) {
                reports.push(TOP_LEVEL);
            } else if is_somewhere_inside_component_or_hook && !is_use {
                reports.push(CALLBACK);
            }
            if reports.is_empty() || memo.has_flow_suppression(hook) {
                continue;
            }
            for message in reports {
                let hint = match possibly_has_early_return {
                    true => " Did you accidentally call a React Hook after an early return?",
                    false => "",
                };
                report(message).data("hint", hint).data("function", function_name.map_or(&b""[..], |it| cx.slice(it.span())));
            }
        }
    }

    /// What is about `useEffectEvent`, which upstream does while it walks.
    fn check_effect_events<'a>(&self, cx: &mut Cx<'a, Self>) {
        let file = cx.file();
        let additional_effect_hooks = file
            .settings()
            .get(b"react-hooks")
            .and_then(|it| it.get(b"additionalEffectHooks")?.as_str())
            .and_then(|it| Regex::from_bytes(it, b"").ok());
        // The calls in which such a function can be referred to, in the order in which the walk enters them.
        let mut effects: Vec<Span> = Vec::new();
        let mut functions: Vec<Reference<'a>> = Vec::new();
        let mut inside_component_or_hook = AncestorMemo::default();
        for e in file.exprs_of_kind(ExprTag::Call) {
            let ExprKind::Call(call) = e.kind() else {
                continue;
            };
            let Some(name) = name_without_react_namespace(call.callee()) else {
                continue;
            };
            let is_effect_event = name.is("useEffectEvent");
            let is_effect = name.is_any(&["useEffect", "useLayoutEffect", "useInsertionEffect"])
                || additional_effect_hooks.as_ref().is_some_and(|it| it.test(name.bytes()));
            if (is_effect || is_effect_event) && !call.args().is_empty() {
                effects.push(e.span());
            }
            if !is_effect_event {
                continue;
            }
            let parent = e.parent();
            let is_expression_statement = matches!(parent, Node::Stmt(stmt) if stmt.tag() == StmtTag::Expr && !stmt.is_wrapper());
            if e.is_chain_root() || !(matches!(parent, Node::VarDecl(_)) || is_expression_statement) {
                cx.report(e, EFFECT_EVENT_PASSED_DOWN);
            }
            // `recordAllUseEffectEventFunctions`
            if let Node::VarDecl(declarator) = parent
                && !e.is_chain_root()
                && call.callee().tag() == ExprTag::Ident
                && declarator.pat().tag() == PatTag::Ident
                && let Some(symbol) = declarator.pat().symbol()
                && let Some(declaring) = symbol.references().find(|it| it.span() == declarator.pat().span())
                && let Node::Func(func) = declaring.scope().node()
                && matches!(func.kind(), FnKind::Decl | FnKind::Arrow)
                && is_inside_component_or_hook(Node::Func(func), &mut inside_component_or_hook)
            {
                functions.extend(symbol.references().filter(|it| *it != declaring));
            }
        }
        if functions.is_empty() {
            return;
        }
        utils::sort::sort_unstable_by_key(&mut effects, |it| (it.start, std::cmp::Reverse(it.end)));
        utils::sort::sort_unstable_by_key(&mut functions, |it| it.span().start);
        functions.dedup();
        for reference in functions {
            let Some(e) = reference.expr().filter(|it| !it.is_jsx_tag_name()) else {
                continue;
            };
            // The call that was entered last, if the walk has not left it.
            let entered = effects.partition_point(|it| it.start <= e.span().start);
            if entered.checked_sub(1).and_then(|at| effects.get(at)).is_some_and(|it| it.contains(e.span())) {
                continue;
            }
            let is_called = matches!(e.parent(), Node::Expr(parent) if parent.tag() == ExprTag::Call);
            let hint = if is_called { "" } else { " It cannot be assigned to a variable or passed down." };
            cx.report(e, EFFECT_EVENT_FUNCTION).data("function", e.text()).data("hint", hint);
        }
    }
}
