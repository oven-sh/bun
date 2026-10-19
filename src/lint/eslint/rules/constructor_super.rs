use bun_core::strings;
use bun_lint::code_path::{Event, Step};
use bun_lint::prelude::*;
use rustc_hash::FxHashMap;
use smallvec::SmallVec;

/// Require `super()` calls in constructors.
pub struct ConstructorSuper;

const MISSING_SOME: Message =
    Message::new("missingSome", "Lacked a call of 'super()' in some code paths.");
const MISSING_ALL: Message = Message::new("missingAll", "Expected to call 'super()'.");
const DUPLICATE: Message = Message::new("duplicate", "Unexpected duplicate 'super()'.");
const BAD_SUPER: Message = Message::new(
    "badSuper",
    "Unexpected 'super()' because 'super' is not a constructor.",
);

/// The negation of oxlint's `is_invalid_super_class`: true for everything that isn't known to be a primitive value.
/// That includes `(A as B)`, which ESLint's version doesn't know about.
fn oxlint_is_possible_constructor(mut e: Expr<'_>) -> bool {
    if !bun_core::StackCheck::init().is_safe_to_recurse() {
        return true;
    }
    loop {
        e = match e.kind() {
            ExprKind::Assign { op: None | Some(BinOp::And), value, .. } => value,
            ExprKind::Assign { op: Some(op), .. } => return matches!(op, BinOp::Or | BinOp::Nullish),
            ExprKind::Binary { op: BinOp::And | BinOp::Comma, right, .. } => right,
            ExprKind::Binary { op, .. } => return matches!(op, BinOp::Or | BinOp::Nullish),
            ExprKind::Cond { yes, .. } if oxlint_is_possible_constructor(yes) => return true,
            ExprKind::Cond { no, .. } => no,
            ExprKind::Number(_)
            | ExprKind::String(_)
            | ExprKind::True
            | ExprKind::False
            | ExprKind::BigInt(_) => return false,
            _ => return true,
        };
    }
}

/// The only form of `null` that oxlint recognizes in an `extends`: without parentheses.
fn is_plain_null(e: Expr<'_>) -> bool {
    e.tag() == ExprTag::Null && !e.is_parenthesized()
}

fn is_super_call(e: Expr<'_>) -> bool {
    e.as_call().is_some_and(|call| call.callee().tag() == ExprTag::Super)
}

/// True if `e` is a whole statement, without parentheses.
fn is_statement(e: Expr<'_>) -> bool {
    !e.is_parenthesized() && matches!(e.parent(), Node::Stmt(parent) if parent.tag() == StmtTag::Expr)
}

/// For `a ? super() : b;`, returns the `super()` that oxlint finds, which is the first if there are two, and the other
/// branch. oxlint treats it as called whatever `a` is.
fn oxlint_branches(cond: Expr<'_>) -> Option<(Expr<'_>, Expr<'_>)> {
    let ExprKind::Cond { yes, no, .. } = cond.kind() else {
        return None;
    };
    let is_found = |e: Expr<'_>| is_super_call(e) && !e.is_parenthesized();
    match is_statement(cond) {
        true if is_found(yes) => Some((yes, no)),
        true if is_found(no) => Some((no, yes)),
        _ => None,
    }
}

/// True if oxlint finds `e`, which is a `super()`. It looks at statements and tests but not inside expressions, so it
/// misses the call in `super(), a();`, `(super());` and `return super();`.
fn oxlint_finds(e: Expr<'_>) -> bool {
    if e.is_parenthesized() {
        return false;
    }
    match e.parent() {
        Node::Case(_) => true,
        Node::Stmt(parent) => match parent.kind() {
            StmtKind::Expr(_) | StmtKind::If { .. } | StmtKind::While { .. } | StmtKind::DoWhile { .. } => true,
            StmtKind::For { test, .. } => test == Some(e),
            StmtKind::ForIn { expr, .. } | StmtKind::ForOf { expr, .. } => expr == e,
            _ => false,
        },
        Node::Expr(parent) => match parent.kind() {
            ExprKind::Cond { test, .. } => test == e || oxlint_branches(parent).is_some_and(|(call, _)| call == e),
            ExprKind::Binary { op: BinOp::And | BinOp::Nullish, left, .. } => left == e,
            ExprKind::Binary { op: BinOp::Or, left, .. } => {
                left == e || is_statement(parent) && is_super_call(left) && !left.is_parenthesized()
            }
            _ => false,
        },
        _ => false,
    }
}

/// True for a loop that only a `break` can end. oxlint assumes there's a path past it, as with any other loop.
fn is_endless(statement: Stmt<'_>) -> bool {
    match statement.kind() {
        StmtKind::For { test, .. } => test.is_none_or(|test| test.tag() == ExprTag::True),
        StmtKind::While { test, .. } => test.tag() == ExprTag::True,
        _ => false,
    }
}

fn super_class_of(constructor: Func<'_>) -> Option<Expr<'_>> {
    match constructor.owner().parent() {
        Node::Class(class) => class.extends(),
        _ => None,
    }
}

/// ESLint's `isPossibleConstructor`
fn is_possible_constructor(mut e: Expr<'_>) -> bool {
    if e.file().language().is_oxlint {
        return !is_plain_null(e) && oxlint_is_possible_constructor(e);
    }
    if !bun_core::StackCheck::init().is_safe_to_recurse() {
        return true;
    }
    loop {
        if utils::is_chain_root(e) {
            return true;
        }
        e = match e.kind() {
            ExprKind::Class(_)
            | ExprKind::This
            | ExprKind::Dot { .. }
            | ExprKind::Index { .. }
            | ExprKind::Call(_)
            | ExprKind::New(_)
            | ExprKind::Yield { .. }
            | ExprKind::TaggedTemplate(_)
            | ExprKind::ImportMeta
            | ExprKind::NewTarget => return true,
            ExprKind::Fn(func) => return !func.is_arrow(),
            ExprKind::Ident(name) => return !name.is("undefined"),
            ExprKind::Assign { op, target, value } => match op {
                None | Some(BinOp::And) => value,
                Some(BinOp::Or | BinOp::Nullish) if is_possible_constructor(target) => return true,
                Some(BinOp::Or | BinOp::Nullish) => value,
                // The result of arithmetic is a primitive value.
                Some(_) => return false,
            },
            ExprKind::Binary { op, left, right } => match op {
                // If `&&` yields its left side, that side is falsy.
                BinOp::And | BinOp::Comma => right,
                BinOp::Or | BinOp::Nullish if is_possible_constructor(right) => return true,
                BinOp::Or | BinOp::Nullish => left,
                _ => return false,
            },
            ExprKind::Cond { yes, .. } if is_possible_constructor(yes) => return true,
            ExprKind::Cond { no, .. } => no,
            _ => return false,
        };
    }
}

/// Finds the first statement directly in `constructor`'s body that's just a `super(..)` call. Returns the statements
/// before it, and the call.
pub fn first_super_statement<'a>(constructor: Func<'a>) -> Option<(impl Iterator<Item = Stmt<'a>>, Call<'a>)> {
    let body = constructor.body_statements()?;
    let (at, call) = body.iter().enumerate().find_map(|(at, statement)| match statement.kind() {
        StmtKind::Expr(e) => e.as_call().filter(|call| call.callee().tag() == ExprTag::Super).map(|call| (at, call)),
        _ => None,
    })?;
    Some((body.iter().take(at), call))
}

/// True if ESLint can lose track of a `super()` called before `statement`. It initializes a segment from the previous
/// segments it has already seen. But a `do` or `for (;;)` can be a single segment that precedes itself, a `default`
/// that isn't the last case is reached from the last test, and a `finally` has separate segments for code that leaves
/// the `try` early.
fn is_winding(statement: Stmt<'_>) -> bool {
    match statement.kind() {
        StmtKind::DoWhile { .. } => true,
        StmtKind::For { test, update, .. } => test.is_none() && update.is_none(),
        StmtKind::Try { finalizer, .. } => finalizer.is_some(),
        StmtKind::Switch { cases, .. } => {
            cases.iter().position(|it| it.test().is_none()).is_some_and(|at| at + 1 < cases.len())
        }
        _ => false,
    }
}

/// True if one of `sorted`, which is in source order, starts in `within` and belongs to `function` itself rather than
/// to a nested function.
fn has_own<'a, T: Copy>(sorted: &[T], within: Span, function: Func<'a>, node: impl Fn(T) -> Node<'a>) -> bool {
    let start = |it: &T| node(*it).span().start;
    let mut rest = sorted.get(sorted.partition_point(|it| start(it) < within.start)..).unwrap_or_default();
    while let Some((&first, after)) = rest.split_first()
        && start(&first) < within.end
    {
        match node(first).enclosing_function() {
            // Skip everything inside the nested function in one step.
            Some(inner) if inner != function => {
                let end = inner.span().end;
                rest = after.get(after.partition_point(|it| start(it) < end)..).unwrap_or_default();
            }
            _ => return true,
        }
    }
    false
}

/// True if the body's statements alone show that `super()` is called exactly once on every path through `constructor`:
/// the call is a statement directly in the body, no `return` comes before it, there's no other call, and nothing after
/// it [is winding](is_winding). Code in a nested function, or in the constructor of a nested class, doesn't count.
fn calls_super_plainly<'a>(constructor: Func<'a>, cx: &mut Cx<'a, ConstructorSuper>) -> bool {
    let Some((_, call)) = first_super_statement(constructor) else {
        return false;
    };
    let (file, callee, whole) = (constructor.file(), call.callee().span(), constructor.span());
    // oxlint doesn't find a parenthesized call or an unreachable one. Here only a `throw` can make it unreachable.
    if file.language().is_oxlint
        && let Node::Expr(e) = call.callee().parent()
        && (e.is_parenthesized()
            || strings::contains(file.slice(Span::new(whole.start, callee.start)), b"throw")
                && matches!(e.parent(), Node::Stmt(statement) if !statement.is_reachable()))
    {
        return false;
    }
    if !constructor.returns().all(|it| it.span().start > callee.start) {
        return false;
    }
    let (before, after) = (Span::new(whole.start, callee.start), Span::new(callee.end, whole.end));
    let callees = cx.state.super_callees.get_or_insert_with(|| {
        let mut callees: Vec<_> = file.exprs_of_kind(ExprTag::Super).filter(|&e| ast_utils::is_callee(e)).collect();
        utils::sort::sort_unstable_by_key(&mut callees, |e| e.span().start);
        callees
    });
    if has_own(callees, before, constructor, Node::Expr) || has_own(callees, after, constructor, Node::Expr) {
        return false;
    }
    let winding = cx.state.winding.get_or_insert_with(|| {
        let tags = [StmtTag::DoWhile, StmtTag::For, StmtTag::Try, StmtTag::Switch];
        let statements = tags.into_iter().flat_map(|tag| file.stmts_of_kind(tag));
        let mut winding: Vec<_> = statements.filter(|&it| is_winding(it)).collect();
        utils::sort::sort_unstable_by_key(&mut winding, |it| it.span().start);
        winding
    });
    !has_own(winding, after, constructor, Node::Stmt)
}

fn is_update_of_for(node: Node<'_>) -> bool {
    let (Node::Expr(e), Node::Stmt(parent)) = (node, node.parent()) else {
        return false;
    };
    parent.as_for().is_some_and(|(_, _, update, _)| update == Some(e))
}

/// Tracks on which paths through a segment `super()` is called.
#[derive(Copy, Clone, Default, PartialEq, Eq)]
struct Called {
    in_every_path: bool,
    in_some_paths: bool,
}

/// The combined state of a segment's previous segments that have already been seen.
struct Before {
    any: bool,
    called: Called,
}

struct SegmentInfo<'a> {
    called: Called,
    /// The `super()` calls considered valid so far. A loop can still turn them into duplicates.
    valid_nodes: SmallVec<[Expr<'a>; 1]>,
}

struct FuncInfo<'a> {
    /// True for the constructor of a class with an `extends`.
    has_extends: bool,
    super_is_constructor: bool,
    code_path: CodePath<'a>,
}

#[derive(Default)]
pub struct State<'a> {
    /// The constructor being checked. Constructors of nested classes are checked separately.
    constructor: Option<Func<'a>>,
    /// One entry per code path around the current node, innermost last.
    func_infos: Vec<FuncInfo<'a>>,
    /// Keyed by `Segment::id`, for the segments of the checked constructors.
    seg_info_map: FxHashMap<u32, SegmentInfo<'a>>,
    /// The `super` of each `super()` in the file, in source order. Built the first time a constructor needs it.
    super_callees: Option<Vec<Expr<'a>>>,
    /// The file's statements that [are winding](is_winding), in source order. Built the first time a constructor needs
    /// it.
    winding: Option<Vec<Stmt<'a>>>,
    /// With an oxlint config: the reachable `super()` calls that oxlint finds, in source order. oxlint reports only
    /// after it has seen the whole constructor.
    found: Vec<Expr<'a>>,
    /// oxlint sees a path around one of them that the segments don't have.
    can_be_bypassed: bool,
    /// One of them runs after another one, or more than once.
    is_repeated: bool,
}

impl<'a> State<'a> {
    /// Returns the innermost code path, if it's one to check.
    fn constructor(&self) -> Option<&FuncInfo<'a>> {
        self.func_infos.last().filter(|it| it.has_extends)
    }

    fn is_called_in_some_path(&self, segment: Segment<'a>) -> bool {
        segment.is_reachable()
            && self.seg_info_map.get(&segment.id()).is_some_and(|it| it.called.in_some_paths)
    }

    fn is_called_in_every_path(&self, segment: Segment<'a>) -> bool {
        segment.is_reachable()
            && self.seg_info_map.get(&segment.id()).is_some_and(|it| it.called.in_every_path)
    }

    fn seen_prev_segments(&self, segment: Segment<'a>) -> Before {
        let (mut any, mut some, mut every) = (false, false, true);
        for prev in segment.prev_segments() {
            if self.seg_info_map.contains_key(&prev.id()) {
                any = true;
                some |= self.is_called_in_some_path(prev);
                every &= self.is_called_in_every_path(prev);
            }
        }
        let called = Called {
            in_every_path: every,
            in_some_paths: some,
        };
        Before { any, called }
    }

    /// Marks the reachable current segments as having called `super()`. Returns the last one's id, and whether any of
    /// them had already called it.
    fn mark_current_segments(&mut self, code_path: CodePath<'a>) -> (Option<u32>, bool) {
        let (mut last, mut is_duplicate) = (None, false);
        for segment in code_path.current_segments() {
            if segment.is_reachable()
                && let Some(info) = self.seg_info_map.get_mut(&segment.id())
            {
                is_duplicate |= info.called.in_some_paths;
                info.called = Called {
                    in_every_path: true,
                    in_some_paths: true,
                };
                last = Some(segment.id());
            }
        }
        (last, is_duplicate)
    }
}

impl ConstructorSuper {
    fn check_constructor<'a>(&self, constructor: Func<'a>, cx: &mut Cx<'a, Self>) {
        cx.state.constructor = Some(constructor);
        for step in constructor.code_path_steps(StmtTag::Return, ExprTag::Call) {
            match step {
                Step::Event(Event::CodePathStart(path, node)) => self.on_code_path_start(path, node, cx),
                Step::Event(Event::CodePathEnd(path, node)) => self.on_code_path_end(path, node, cx),
                Step::Event(Event::SegmentStart(segment, node)) => self.on_segment_start(segment, node, cx),
                Step::Event(Event::SegmentLoop(from, to, node)) => self.on_segment_loop(from, to, node, cx),
                Step::Event(_) => {}
                Step::Enter(node) => self.on_return(node, cx),
                Step::Exit(node) => self.on_call_exit(node, cx),
            }
        }
        cx.state.seg_info_map.clear();
        cx.state.found.clear();
        cx.state.can_be_bypassed = false;
        cx.state.is_repeated = false;
    }

    fn on_code_path_start<'a>(&self, code_path: CodePath<'a>, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        let super_class = match node {
            // `static constructor() {}` is a method.
            Node::Func(func)
                if cx.state.constructor == Some(func)
                    && func.kind() == FnKind::Constructor
                    && !func.flags().contains(Flags::STATIC) =>
            {
                super_class_of(func)
            }
            _ => None,
        };
        cx.state.func_infos.push(FuncInfo {
            has_extends: super_class.is_some(),
            super_is_constructor: super_class.is_some_and(is_possible_constructor),
            code_path,
        });
    }

    fn on_code_path_end<'a>(&self, code_path: CodePath<'a>, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        let (Some(FuncInfo { has_extends: true, super_is_constructor, .. }), Node::Func(func)) =
            (cx.state.func_infos.pop(), node)
        else {
            return;
        };
        if cx.language().is_oxlint {
            return Self::on_end_for_oxlint(func, super_is_constructor, code_path, cx);
        }
        let returned_segments = code_path.returned_segments();
        if returned_segments.iter().all(|it| cx.state.is_called_in_every_path(*it)) {
            return;
        }
        let called_in_some_paths = returned_segments.iter().any(|it| cx.state.is_called_in_some_path(*it));
        cx.report(func.owner(), if called_in_some_paths { MISSING_SOME } else { MISSING_ALL });
    }

    fn on_end_for_oxlint<'a>(
        func: Func<'a>,
        super_is_constructor: bool,
        code_path: CodePath<'a>,
        cx: &mut Cx<'a, Self>,
    ) {
        let found = std::mem::take(&mut cx.state.found);
        let Some((first, rest)) = found.split_first() else {
            // If oxlint finds no call, it doesn't check how the constructor ends, except after `extends null`.
            let is_expected = super_is_constructor
                || super_class_of(func).is_some_and(is_plain_null)
                    && !func.returns().any(|it| matches!(it.as_return(), Some(Some(_))));
            if is_expected {
                cx.report(func.owner(), MISSING_ALL);
            }
            return;
        };
        if !super_is_constructor {
            return;
        }
        let returned_segments = code_path.returned_segments();
        if cx.state.can_be_bypassed || !returned_segments.iter().all(|it| cx.state.is_called_in_every_path(*it)) {
            cx.report(func.owner(), MISSING_SOME);
        }
        if cx.state.is_repeated {
            for call in rest {
                cx.report(*call, DUPLICATE)
                    .labels_with(|labels| labels.push(first.span(), "`super()` was first called here."));
            }
        }
    }

    fn on_segment_start<'a>(&self, segment: Segment<'a>, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        if cx.state.constructor().is_none() {
            return;
        }
        // Like upstream, mark the segment as seen before looking at its previous segments. It's its own previous
        // segment if it's a whole loop, as in `do { a(); } while (b);`. Then `super()` never counts as called on every
        // path to it or to what follows.
        let unknown = SegmentInfo {
            called: Called::default(),
            valid_nodes: SmallVec::new(),
        };
        let id = segment.id();
        cx.state.seg_info_map.insert(id, unknown);
        let before = cx.state.seen_prev_segments(segment);
        let is_other_branch_of_call = cx.language().is_oxlint
            && matches!((node, node.parent()), (Node::Expr(e), Node::Expr(parent))
                if oxlint_branches(parent).is_some_and(|(_, other)| other == e));
        let called = Called {
            // A `for` loop's update segment is created early, before its previous segments are seen. It's never the
            // only previous segment of another one, so `true` here lets the others decide.
            in_every_path: before.any && before.called.in_every_path || is_update_of_for(node) || is_other_branch_of_call,
            in_some_paths: before.any && before.called.in_some_paths || is_other_branch_of_call,
        };
        if let Some(info) = cx.state.seg_info_map.get_mut(&id) {
            info.called = called;
        }
    }

    /// At each jump back to a loop's start, ESLint traverses the segments again from there. That traversal also reaches
    /// everything after the loop, which it skips.
    fn on_segment_loop<'a>(
        &self,
        from_segment: Segment<'a>,
        to_segment: Segment<'a>,
        _: Node<'a>,
        cx: &mut Cx<'a, Self>,
    ) {
        let Some(code_path) = cx.state.constructor().map(|it| it.code_path) else {
            return;
        };
        code_path.traverse_segments_between(Some(to_segment), Some(from_segment), |segment, controller| {
            // A segment that hasn't been seen yet is after the loop.
            match cx.state.seg_info_map.contains_key(&segment.id()) {
                true => Self::revisit_segment(segment, cx),
                false => controller.skip(),
            }
        });
    }

    fn revisit_segment<'a>(segment: Segment<'a>, cx: &mut Cx<'a, Self>) {
        let before = cx.state.seen_prev_segments(segment);
        let Some(info) = cx.state.seg_info_map.get_mut(&segment.id()) else {
            return;
        };
        info.called = Called {
            in_every_path: info.called.in_every_path || before.called.in_every_path,
            in_some_paths: info.called.in_some_paths || before.called.in_some_paths,
        };
        if before.called.in_some_paths {
            let again = std::mem::take(&mut info.valid_nodes);
            if cx.language().is_oxlint {
                // oxlint assumes a loop runs either zero times or several times.
                cx.state.can_be_bypassed |= !again.is_empty();
                cx.state.is_repeated |= !again.is_empty();
            } else {
                for node in again {
                    cx.report(node, DUPLICATE);
                }
            }
        }
    }

    fn on_call_exit<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        let Node::Expr(e) = node else {
            return;
        };
        let is_oxlint = cx.language().is_oxlint;
        if !is_super_call(e) || is_oxlint && !oxlint_finds(e) {
            return;
        }
        let Some(&FuncInfo {
            code_path,
            super_is_constructor,
            ..
        }) = cx.state.constructor()
        else {
            return;
        };
        let (Some(last), is_duplicate) = cx.state.mark_current_segments(code_path) else {
            return;
        };
        if is_oxlint {
            let constructor = cx.state.constructor.map(Node::Func);
            // oxlint treats the expression that a `for`-`in` iterates over as part of the loop.
            let is_in_head = matches!(e.parent(), Node::Stmt(it) if matches!(it.tag(), StmtTag::ForIn | StmtTag::ForOf));
            let mut enclosing_nodes = node.ancestors().take_while(|it| Some(*it) != constructor);
            cx.state.found.push(e);
            cx.state.is_repeated |= is_duplicate || is_in_head;
            cx.state.can_be_bypassed |= is_in_head
                || !is_duplicate && enclosing_nodes.any(|it| matches!(it, Node::Stmt(it) if is_endless(it)));
        }
        if is_duplicate && !is_oxlint {
            cx.report(e, DUPLICATE);
        } else if !super_is_constructor {
            let super_class = cx.state.constructor.and_then(super_class_of);
            cx.report(e, BAD_SUPER).labels_with(|labels| {
                if let Some(super_class) = super_class {
                    labels.push(super_class.outer_span(), match is_plain_null(super_class) {
                        true => "`null` does not provide a constructor to call.",
                        false => "This superclass expression is not constructable.",
                    });
                }
            });
        } else if let Some(info) = cx.state.seg_info_map.get_mut(&last) {
            info.valid_nodes.push(e);
        }
    }

    /// Returning a value is a substitute for `super()`.
    fn on_return<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        if let Node::Stmt(statement) = node
            && let Some(Some(_)) = statement.as_return()
            && let Some(code_path) = cx.state.constructor().map(|it| it.code_path)
        {
            cx.state.mark_current_segments(code_path);
        }
    }
}

impl Rule for ConstructorSuper {
    const META: Meta = Meta::eslint("constructor-super", Kind::Problem).recommended();
    const ON: On = On::new().classes();
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        ConstructorSuper
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<State<'a>> {
        Some(State::default())
    }

    fn class<'a>(&self, class: Class<'a>, cx: &mut Cx<'a, Self>) {
        let Some(super_class) = class.extends() else {
            return;
        };
        let is_constructor = |it: &Member<'a>| it.kind() == MemberKind::Constructor && !it.flags().contains(Flags::STATIC);
        // oxlint only looks at the first constructor, which has no body if there are overloads.
        let count = if cx.language().is_oxlint { 1 } else { usize::MAX };
        let constructors = class.members().iter().filter(is_constructor).take(count);
        for constructor in constructors.filter_map(Member::func).filter(|it| it.has_body()) {
            if !(is_possible_constructor(super_class) && calls_super_plainly(constructor, cx)) {
                self.check_constructor(constructor, cx);
            }
        }
    }
}
