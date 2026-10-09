use bun_lint::code_path::{Event, Step};
use bun_lint::prelude::*;
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::SmallVec;
use std::collections::BTreeSet;

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

/// What oxlint's `is_invalid_super_class` does not hold for: everything but what is known to be a primitive value, so
/// `(A as B)` too, which ESLint knows nothing about.
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
            | ExprKind::BigInt(_)
            | ExprKind::Null => return false,
            _ => return true,
        };
    }
}

/// ESLint's `isPossibleConstructor`
fn is_possible_constructor(mut e: Expr<'_>) -> bool {
    if e.file().language().is_oxlint {
        return oxlint_is_possible_constructor(e);
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
                // If `&&` yields its left side, that is falsy.
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

/// The first statement directly in the body of `constructor` that is a `super(..)` and nothing else,
/// with what precedes it and the call.
pub fn first_super_statement<'a>(constructor: Func<'a>) -> Option<(impl Iterator<Item = Stmt<'a>>, Call<'a>)> {
    let body = constructor.body_statements()?;
    let (at, call) = body.iter().enumerate().find_map(|(at, statement)| match statement.kind() {
        StmtKind::Expr(e) => e.as_call().filter(|call| call.callee().tag() == ExprTag::Super).map(|call| (at, call)),
        _ => None,
    })?;
    Some((body.iter().take(at), call))
}

/// Whether ESLint can lose a `super()` that is called before `statement`. It starts a segment from those before it
/// that it has seen: a `do` or a `for (;;)` can be one segment that is before itself, a `default` that is not the
/// last case is reached from the last test, and a `finally` has segments of its own for what leaves the `try` early.
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

/// Whether one of `sorted`, which are in source order, starts in `within` and is in `function` itself, not in a
/// function in it.
fn has_own<'a, T: Copy>(sorted: &[T], within: Span, function: Func<'a>, node: impl Fn(T) -> Node<'a>) -> bool {
    let start = |it: &T| node(*it).span().start;
    let mut rest = sorted.get(sorted.partition_point(|it| start(it) < within.start)..).unwrap_or_default();
    while let Some((&first, after)) = rest.split_first()
        && start(&first) < within.end
    {
        match node(first).enclosing_function() {
            // All that is in a function in it is passed over at once.
            Some(inner) if inner != function => {
                let end = inner.span().end;
                rest = after.get(after.partition_point(|it| start(it) < end)..).unwrap_or_default();
            }
            _ => return true,
        }
    }
    false
}

/// Whether it can be told from the statements of the body alone that `super()` is called exactly once on every way
/// through `constructor`: it is a statement of its own there, no `return` precedes it, there is no other, and nothing
/// after it [is winding](is_winding). What is in a function or in the constructor of a class in it is not its own.
fn calls_super_plainly<'a>(constructor: Func<'a>, cx: &mut Cx<'a, ConstructorSuper>) -> bool {
    let Some((_, call)) = first_super_statement(constructor) else {
        return false;
    };
    let (file, callee, whole) = (constructor.file(), call.callee().span(), constructor.span());
    if !constructor.returns().all(|it| it.span().start > callee.start) {
        return false;
    }
    let (before, after) = (Span::new(whole.start, callee.start), Span::new(callee.end, whole.end));
    let callees = cx.state.super_callees.get_or_insert_with(|| {
        let mut callees: Vec<_> = file.exprs_of_kind(ExprTag::Super).filter(|&e| ast_utils::is_callee(e)).collect();
        callees.sort_unstable_by_key(|e| e.span().start);
        callees
    });
    if has_own(callees, before, constructor, Node::Expr) || has_own(callees, after, constructor, Node::Expr) {
        return false;
    }
    let winding = cx.state.winding.get_or_insert_with(|| {
        let tags = [StmtTag::DoWhile, StmtTag::For, StmtTag::Try, StmtTag::Switch];
        let statements = tags.into_iter().flat_map(|tag| file.stmts_of_kind(tag));
        let mut winding: Vec<_> = statements.filter(|&it| is_winding(it)).collect();
        winding.sort_unstable_by_key(|it| it.span().start);
        winding
    });
    !has_own(winding, after, constructor, Node::Stmt)
}

fn is_update_of_for(node: Node<'_>) -> bool {
    let (Node::Expr(e), Node::Stmt(parent)) = (node, node.parent()) else {
        return false;
    };
    matches!(parent.kind(), StmtKind::For { update, .. } if update == Some(e))
}

/// On which of the paths that lead through a segment `super()` is called.
#[derive(Copy, Clone, Default, PartialEq, Eq)]
struct Called {
    in_every_path: bool,
    in_some_paths: bool,
}

/// What the segments before a segment that have been seen say.
struct Before<'a> {
    any: bool,
    called: Called,
    /// One of them in which it is not called on every path.
    lacking: Option<Segment<'a>>,
}

struct SegmentInfo<'a> {
    called: Called,
    /// [`Before::lacking`] when that was last asked. While it still lacks it, nothing before the segment can make it
    /// be called on every path to it.
    lacking: Option<Segment<'a>>,
    /// The `super()` calls that have been found valid, which a loop can make duplicates.
    valid_nodes: SmallVec<[Expr<'a>; 1]>,
}

struct FuncInfo<'a> {
    /// It is the constructor of a class that has an `extends`.
    has_extends: bool,
    super_is_constructor: bool,
    code_path: CodePath<'a>,
}

#[derive(Default)]
pub struct State<'a> {
    /// The constructor that is checked. Those of the classes in it are checked on their own.
    constructor: Option<Func<'a>>,
    /// For each of the code paths around the current node, the innermost last.
    func_infos: Vec<FuncInfo<'a>>,
    /// By `Segment::id`, for the segments of the constructors that are checked.
    seg_info_map: FxHashMap<u32, SegmentInfo<'a>>,
    /// The `super` of each `super()` of the file, in source order, once a constructor asks.
    super_callees: Option<Vec<Expr<'a>>>,
    /// The statements of the file that [are winding](is_winding), in source order, once a constructor asks.
    winding: Option<Vec<Stmt<'a>>>,
    /// By `Segment::id`, all the segments that going through them again could change: those that no longer agree with
    /// what is before them. See [`ConstructorSuper::on_segment_loop`].
    stale: BTreeSet<u32>,
    /// The ids of the two ends of the edges that lead from a segment that has been seen to one with a smaller id that
    /// has been seen, without those that another makes needless: both ends ascend.
    edges_down: Vec<(u32, u32)>,
    /// The greatest id of a segment that has been seen.
    last_seen: u32,
}

impl<'a> State<'a> {
    /// The innermost code path, if it is one to check.
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

    fn seen_prev_segments(&self, segment: Segment<'a>) -> Before<'a> {
        let (mut any, mut some, mut lacking) = (false, false, None);
        for prev in segment.prev_segments() {
            if self.seg_info_map.contains_key(&prev.id()) {
                any = true;
                some |= self.is_called_in_some_path(prev);
                if lacking.is_none() && !self.is_called_in_every_path(prev) {
                    lacking = Some(prev);
                }
            }
        }
        let called = Called {
            in_every_path: lacking.is_none(),
            in_some_paths: some,
        };
        Before { any, called, lacking }
    }

    /// To be called once `segment` has been seen, and whenever `super()` is found to be called in it: finds the
    /// segments after it that have been seen and no longer agree with it.
    fn mark_stale_after(&mut self, segment: Segment<'a>) {
        let (some, every) = (self.is_called_in_some_path(segment), self.is_called_in_every_path(segment));
        if !some && !every {
            return;
        }
        for next in segment.next_segments() {
            let Some(info) = self.seg_info_map.get(&next.id()) else {
                continue;
            };
            let mut is_stale = some && !(info.called.in_some_paths && info.valid_nodes.is_empty());
            if !is_stale
                && every
                && !info.called.in_every_path
                && !info.lacking.is_some_and(|it| !self.is_called_in_every_path(it))
            {
                let before = self.seen_prev_segments(next);
                is_stale = before.called.in_every_path;
                if let Some(info) = self.seg_info_map.get_mut(&next.id()) {
                    info.lacking = before.lacking;
                }
            }
            if is_stale {
                self.stale.insert(next.id());
            }
        }
    }

    fn mark_stale_after_current_segments(&mut self, code_path: CodePath<'a>) {
        for segment in code_path.current_segments() {
            self.mark_stale_after(segment);
        }
    }

    fn note_edge_down(&mut self, from: u32, to: u32) {
        let edges = &mut self.edges_down;
        let at = edges.partition_point(|&(it, _)| it < from);
        if edges.get(at).is_some_and(|&(_, it)| it <= to) {
            return;
        }
        let end = edges.partition_point(|&(it, _)| it <= from);
        let keep = edges.get(..end).unwrap_or_default().partition_point(|&(_, it)| it < to);
        edges.splice(keep..end, [(from, to)]);
    }

    /// Whether going through the segments from `first` again could change one. An edge leads to a greater id unless
    /// it is among `edges_down`, so there is a least id that can be got to through what has been seen.
    fn is_any_stale_from(&self, first: Segment<'a>) -> bool {
        let mut least = first.id();
        while let Some(&(_, to)) = self.edges_down.get(self.edges_down.partition_point(|&(from, _)| from < least))
            && to < least
        {
            least = to;
        }
        self.stale.range(least..).next().is_some()
    }

    /// The segments that have been seen with which ESLint's `traverseSegments({ first, last })` calls back, in that
    /// order, found without going through those that are made after all that have been seen, of which there can be
    /// many. `None` where it cannot be told without them: at a segment that only loops lead to, which is left out or
    /// not depending on what has been left out before, and if one is left waiting for a segment before it, which may
    /// be got to through them.
    fn seen_segments_between(&self, first: Segment<'a>, last: Segment<'a>) -> Option<Vec<Segment<'a>>> {
        let is_seen = |id: u32| self.seg_info_map.contains_key(&id);
        if !is_seen(first.id()) {
            return None;
        }
        let (mut visited, mut skipped) = (FxHashSet::default(), FxHashSet::default());
        let mut waiting = FxHashSet::default();
        let mut found = vec![first];
        visited.insert(first.id());
        if first.id() == last.id() {
            skipped.insert(first.id());
        }
        let mut stack = vec![(first.next_segments(), 0)];
        while let Some((next, at)) = stack.last_mut() {
            let Some(&segment) = next.get(*at) else {
                stack.pop();
                continue;
            };
            *at += 1;
            let id = segment.id();
            if id > self.last_seen || visited.contains(&id) {
                continue;
            }
            let prev = segment.prev_segments();
            let is_looped = |it: &Segment<'a>| segment.is_looped_prev_segment(*it);
            if !prev.iter().all(|it| visited.contains(&it.id()) || is_looped(it)) {
                if is_seen(id) {
                    waiting.insert(id);
                }
                continue;
            }
            if prev.iter().all(is_looped) {
                return None;
            }
            visited.insert(id);
            waiting.remove(&id);
            if !skipped.is_empty() && prev.iter().all(|it| skipped.contains(&it.id()) || is_looped(it)) {
                skipped.insert(id);
            } else {
                if is_seen(id) {
                    found.push(segment);
                }
                if !is_seen(id) || id == last.id() {
                    skipped.insert(id);
                }
            }
            stack.push((segment.next_segments(), 0));
        }
        waiting.is_empty().then_some(found)
    }

    /// Marks the current segments that are reachable as having called `super()`. Returns the id of
    /// the last of them, and whether one of them had called it before.
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
        cx.state.stale.clear();
        cx.state.edges_down.clear();
        cx.state.last_seen = 0;
    }

    fn on_code_path_start<'a>(&self, code_path: CodePath<'a>, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        let super_class = match node {
            // `static constructor() {}` is a method.
            Node::Func(func)
                if cx.state.constructor == Some(func)
                    && func.kind() == FnKind::Constructor
                    && !func.flags().contains(Flags::STATIC) =>
            {
                match func.owner().parent() {
                    Node::Class(class) => class.extends(),
                    _ => None,
                }
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
        let (Some(FuncInfo { has_extends: true, .. }), Node::Func(func)) = (cx.state.func_infos.pop(), node)
        else {
            return;
        };
        let returned_segments = code_path.returned_segments();
        if returned_segments.iter().all(|it| cx.state.is_called_in_every_path(*it)) {
            return;
        }
        let called_in_some_paths = returned_segments.iter().any(|it| cx.state.is_called_in_some_path(*it));
        cx.report(func.owner(), if called_in_some_paths { MISSING_SOME } else { MISSING_ALL });
    }

    fn on_segment_start<'a>(&self, segment: Segment<'a>, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        if cx.state.constructor().is_none() {
            return;
        }
        // As upstream, it has been seen before those before it are looked at. One of them is itself if it is all of a
        // loop, as in `do { a(); } while (b);`: then `super()` is never called on every path to it, and to what
        // follows.
        let unknown = SegmentInfo {
            called: Called::default(),
            lacking: None,
            valid_nodes: SmallVec::new(),
        };
        let id = segment.id();
        cx.state.seg_info_map.insert(id, unknown);
        cx.state.last_seen = cx.state.last_seen.max(id);
        let before = cx.state.seen_prev_segments(segment);
        let called = Called {
            // The segment of the update of a `for` is made in advance, before what precedes it is
            // seen. It is never the only one before another: this makes the others decide.
            in_every_path: before.any && before.called.in_every_path || is_update_of_for(node),
            in_some_paths: before.any && before.called.in_some_paths,
        };
        if let Some(info) = cx.state.seg_info_map.get_mut(&id) {
            info.called = called;
            info.lacking = before.lacking;
        }
        // Going through it again finds it called in all of none.
        if !before.any && !called.in_every_path {
            cx.state.stale.insert(id);
        }
        for next in segment.next_segments().iter().map(|it| it.id()).filter(|&it| it < id) {
            if cx.state.seg_info_map.contains_key(&next) {
                cx.state.note_edge_down(id, next);
            }
        }
        for prev in segment.prev_segments().iter().map(|it| it.id()).filter(|&it| it > id) {
            if cx.state.seg_info_map.contains_key(&prev) {
                cx.state.note_edge_down(prev, id);
            }
        }
        cx.state.mark_stale_after(segment);
    }

    /// ESLint goes through the segments from the start of the loop again at each way back to it, and through all that
    /// follow in the function, which it leaves out. That changes a segment only if it no longer agrees with those
    /// before it.
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
        if !cx.state.is_any_stale_from(to_segment) {
            return;
        }
        if let Some(segments) = cx.state.seen_segments_between(to_segment, from_segment) {
            for segment in segments {
                Self::go_through_again(segment, cx);
            }
            return;
        }
        code_path.traverse_segments_between(Some(to_segment), Some(from_segment), |segment, controller| {
            // What has not been seen is after the loop.
            match cx.state.seg_info_map.contains_key(&segment.id()) {
                true => Self::go_through_again(segment, cx),
                false => controller.skip(),
            }
        });
    }

    fn go_through_again<'a>(segment: Segment<'a>, cx: &mut Cx<'a, Self>) {
        let before = cx.state.seen_prev_segments(segment);
        let Some(info) = cx.state.seg_info_map.get_mut(&segment.id()) else {
            return;
        };
        let called = Called {
            in_every_path: info.called.in_every_path || before.called.in_every_path,
            in_some_paths: info.called.in_some_paths || before.called.in_some_paths,
        };
        let is_changed = called != info.called;
        info.called = called;
        info.lacking = before.lacking;
        if before.called.in_some_paths {
            for node in std::mem::take(&mut info.valid_nodes) {
                cx.report(node, DUPLICATE);
            }
        }
        cx.state.stale.remove(&segment.id());
        if is_changed {
            cx.state.mark_stale_after(segment);
        }
    }

    fn on_call_exit<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        let Node::Expr(e) = node else {
            return;
        };
        if !e.as_call().is_some_and(|call| call.callee().tag() == ExprTag::Super) {
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
        if is_duplicate {
            cx.report(e, DUPLICATE);
        } else if !super_is_constructor {
            cx.report(e, BAD_SUPER);
        } else if let Some(info) = cx.state.seg_info_map.get_mut(&last) {
            info.valid_nodes.push(e);
        }
        // After the call is kept: a segment can be after itself.
        cx.state.mark_stale_after_current_segments(code_path);
    }

    /// Returning a value is a substitute for `super()`.
    fn on_return<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        if let Node::Stmt(statement) = node
            && let StmtKind::Return(Some(_)) = statement.kind()
            && let Some(code_path) = cx.state.constructor().map(|it| it.code_path)
        {
            cx.state.mark_current_segments(code_path);
            cx.state.mark_stale_after_current_segments(code_path);
        }
    }
}

impl Rule for ConstructorSuper {
    const META: Meta = Meta::eslint("constructor-super", Kind::Problem).recommended();
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        ConstructorSuper
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) -> State<'a> {
        on.classes(|rule, class, cx| {
            let Some(super_class) = class.extends() else {
                return;
            };
            let constructors = class.members().iter().filter(|it| it.kind() == MemberKind::Constructor);
            for constructor in constructors.filter_map(Member::func).filter(|it| it.has_body()) {
                if !(is_possible_constructor(super_class) && calls_super_plainly(constructor, cx)) {
                    rule.check_constructor(constructor, cx);
                }
            }
        });
        State::default()
    }
}
