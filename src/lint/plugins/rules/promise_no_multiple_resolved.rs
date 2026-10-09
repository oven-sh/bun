use crate::oxlint::promise::is_promise_constructor;
use bun_lint::code_path::{Event, Step, steps_of_code_path};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::SmallVec;

/// This rule warns of paths that resolve multiple times in executor functions of Promise constructors.
///
/// oxlint goes through the basic blocks of its control flow graph. Here a block is a segment of the code path of the function, with
/// two kinds of segments taken together: see [`Blocks::new`].
pub struct NoMultipleResolved;

const ALREADY_RESOLVED: Message =
    Message::new("", "Promise should not be resolved multiple times. Promise is already resolved on line {{line}}.");
const POTENTIALLY_ALREADY_RESOLVED: Message =
    Message::new("", "Promise should not be resolved multiple times. Promise is potentially resolved on line {{line}}.");

impl Rule for NoMultipleResolved {
    const META: Meta = Meta::oxlint(Plugin::Promise, "no-multiple-resolved", Kind::Problem);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoMultipleResolved
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions("Promise") {
            return;
        }
        on.exprs([ExprTag::New], |_, e, cx| {
            let ExprKind::New(new_expr) = e.kind() else {
                return;
            };
            let Some(executor) = get_promise_constructor_inline_executor(new_expr) else {
                return;
            };
            let symbol_of = |index: usize| executor.params().get(index).filter(|it| !it.is_rest()).and_then(|it| it.pat().symbol());
            let resolve_finder = ResolveFinder { resolve_symbol: symbol_of(0), reject_symbol: symbol_of(1) };
            // The executor and the functions in it are checked each for itself. There is something to find where the two are referred
            // to twice.
            let mut references_in: FxHashMap<Func<'a>, u32> = FxHashMap::default();
            let mut diagnostics = Vec::new();
            let resolvers = [resolve_finder.resolve_symbol, resolve_finder.reject_symbol].into_iter().flatten();
            for reference in resolvers.flat_map(Symbol::references) {
                let Node::Func(func) = reference.scope().variable_scope().node() else {
                    continue;
                };
                let count = references_in.entry(func).or_insert(0);
                *count += 1;
                if *count == 2 && func.kind() != FnKind::StaticBlock {
                    check(func, resolve_finder, &mut diagnostics);
                }
            }
            for (message, resolved, prev_resolved) in diagnostics {
                cx.report(resolved, message).data("line", cx.file().line_of(prev_resolved.span().end).to_string());
            }
        });
    }
}

/// The function in `new Promise(function (resolve, reject) {})`.
fn get_promise_constructor_inline_executor(new_expr: Call<'_>) -> Option<Func<'_>> {
    let executor = new_expr.args().first().filter(|_| new_expr.args().len() == 1 && is_promise_constructor(new_expr))?;
    executor.as_fn().filter(|_| !executor.is_parenthesized())
}

/// The message, the call that is reported, and the call before it.
type Diagnostics<'a> = Vec<(Message, Expr<'a>, Expr<'a>)>;

#[derive(Copy, Clone, PartialEq, Eq)]
enum ResolvedKind {
    Certain,
    Potential,
    None,
}

#[derive(Copy, Clone)]
struct BlockResolvedInfo<'a> {
    resolved: Option<Expr<'a>>,
    kind: ResolvedKind,
    throwable_after_resolved: bool,
}

/// What is found in the expression statements that start in a segment.
#[derive(Default)]
struct Found<'a> {
    resolved: SmallVec<[Expr<'a>; 2]>,
    last_throwable_expr_span: Option<Span>,
}

#[derive(Copy, Clone)]
struct ResolveFinder<'a> {
    resolve_symbol: Option<Symbol<'a>>,
    reject_symbol: Option<Symbol<'a>>,
}

impl<'a> ResolveFinder<'a> {
    /// Looks for the calls of `resolve` and `reject` in `expression`, but not in functions, nor in a call: not in what is called and
    /// not in its arguments. `is_in_try_block`: in the block of a `try` statement with a `catch`, where what can throw is noted.
    fn visit_expression(self, expression: Expr<'a>, is_in_try_block: bool, found: &mut Found<'a>) {
        enum Visit<'a> {
            Enter(Node<'a>),
            Leave(Span),
        }
        let mut steps = vec![Visit::Enter(Node::Expr(expression))];
        while let Some(step) = steps.pop() {
            let node = match step {
                Visit::Leave(span) => {
                    found.last_throwable_expr_span = Some(span);
                    continue;
                }
                Visit::Enter(Node::Func(_) | Node::Type(_)) => continue,
                Visit::Enter(node) => node,
            };
            if let Node::Expr(e) = node {
                match e.kind() {
                    ExprKind::Call(call_expr) => {
                        let callee = call_expr.callee();
                        let symbol = callee.symbol().filter(|_| !callee.is_parenthesized());
                        if symbol.is_some() && (symbol == self.resolve_symbol || symbol == self.reject_symbol) {
                            found.resolved.push(e);
                        } else if is_in_try_block {
                            found.last_throwable_expr_span = Some(e.span());
                        }
                        continue;
                    }
                    ExprKind::Dot { .. } if e.is_private_member() || e.is_jsx_tag_name() => {}
                    ExprKind::New(_) | ExprKind::ImportCall { .. } | ExprKind::Yield { .. } | ExprKind::Dot { .. } | ExprKind::Index { .. }
                        if is_in_try_block =>
                    {
                        steps.push(Visit::Leave(e.span()));
                    }
                    _ => {}
                }
            }
            let first = steps.len();
            node.for_each_child(|child| steps.push(Visit::Enter(child)));
            if let Some(children) = steps.get_mut(first..) {
                children.reverse();
            }
        }
    }
}

/// The block of a `try` statement that is being gone through.
struct TryBlock<'a> {
    block: Stmt<'a>,
    handler: Option<Stmt<'a>>,
    /// The segments that are in it, but not in the block of another `try` statement in it.
    segments: Vec<Segment<'a>>,
}

/// What going through the code path of a function tells.
#[derive(Default)]
struct Walk<'a> {
    code_path: Option<CodePath<'a>>,
    /// A segment, and another that it is gone through side by side with, in a `finally` block.
    side_by_side: Vec<(Segment<'a>, Segment<'a>)>,
    /// The segment that each `catch` starts with, and the segments in the block of its `try` statement.
    catch_starts: Vec<(Segment<'a>, Vec<Segment<'a>>)>,
    /// The ids of the segments that start in the block of a `try` statement with a `catch`.
    in_try_block: FxHashSet<u32>,
    /// By the id of the segment.
    found: FxHashMap<u32, Found<'a>>,
}

impl<'a> Walk<'a> {
    fn new(func: Func<'a>, resolve_finder: ResolveFinder<'a>) -> Walk<'a> {
        let root = Node::Func(func);
        let mut walk = Walk::default();
        let mut current_segments: SmallVec<[Segment<'a>; 4]> = SmallVec::new();
        let mut try_blocks: Vec<TryBlock<'a>> = Vec::new();
        // How many of them have a `catch`.
        let mut try_block_depth = 0;
        // By the `catch` block: the segments in the block of its `try` statement, until it starts.
        let mut leading_to_catch: FxHashMap<Stmt<'a>, Vec<Segment<'a>>> = FxHashMap::default();
        for step in steps_of_code_path(root, [StmtTag::Expr, StmtTag::Try], StmtTag::Block) {
            match step {
                Step::Event(Event::CodePathStart(path, node)) if node == root => walk.code_path = Some(path),
                Step::Event(Event::SegmentStart(segment, node)) if Some(segment.code_path()) == walk.code_path => {
                    if let Some(&first) = current_segments.first() {
                        walk.side_by_side.push((segment, first));
                    }
                    current_segments.push(segment);
                    let catch_start = match node {
                        Node::Stmt(handler) => leading_to_catch.remove(&handler),
                        _ => None,
                    };
                    if let Some(segments) = catch_start {
                        walk.catch_starts.push((segment, segments));
                        continue;
                    }
                    if let Some(innermost) = try_blocks.last_mut().filter(|it| it.handler.is_some()) {
                        innermost.segments.push(segment);
                    }
                    if try_block_depth > 0 {
                        walk.in_try_block.insert(segment.id());
                    }
                }
                Step::Event(Event::SegmentEnd(segment, _)) => current_segments.retain(|it| *it != segment),
                Step::Enter(Node::Stmt(statement)) => match statement.kind() {
                    StmtKind::Try { block, handler, .. } => {
                        try_block_depth += usize::from(handler.is_some());
                        try_blocks.push(TryBlock {
                            block,
                            handler,
                            segments: if handler.is_some() { current_segments.to_vec() } else { Vec::new() },
                        });
                    }
                    StmtKind::Expr(e) => {
                        if let Some(segment) = current_segments.first() {
                            resolve_finder.visit_expression(e, try_block_depth > 0, walk.found.entry(segment.id()).or_default());
                        }
                    }
                    _ => {}
                },
                Step::Exit(Node::Stmt(block)) if try_blocks.last().is_some_and(|it| it.block == block) => {
                    if let Some(TryBlock { handler: Some(handler), segments, .. }) = try_blocks.pop() {
                        try_block_depth -= 1;
                        leading_to_catch.insert(handler, segments);
                    }
                }
                _ => {}
            }
        }
        walk
    }
}

/// A tree that grows at its leaves, in which it takes a logarithmic number of steps to go up. The node 0 is the root.
struct Tree {
    parent: Vec<usize>,
    /// An ancestor further up: see "jump pointers".
    jump: Vec<usize>,
    depth: Vec<usize>,
}

impl Tree {
    fn new(len: usize) -> Tree {
        Tree { parent: vec![0; len], jump: vec![0; len], depth: vec![0; len] }
    }

    fn parent(&self, node: usize) -> usize {
        self.parent.get(node).copied().unwrap_or(0)
    }

    fn jump(&self, node: usize) -> usize {
        self.jump.get(node).copied().unwrap_or(0)
    }

    fn depth(&self, node: usize) -> usize {
        self.depth.get(node).copied().unwrap_or(0)
    }

    fn add(&mut self, node: usize, parent: usize) {
        let (near, far) = (self.jump(parent), self.jump(self.jump(parent)));
        let jump = if self.depth(parent) - self.depth(near) == self.depth(near) - self.depth(far) { far } else { parent };
        let depth = self.depth(parent) + 1;
        for (all, value) in [(&mut self.parent, parent), (&mut self.jump, jump), (&mut self.depth, depth)] {
            if let Some(slot) = all.get_mut(node) {
                *slot = value;
            }
        }
    }

    /// The ancestor of `node` at `depth`, which is not deeper than `node`.
    fn ancestor_at(&self, node: usize, depth: usize) -> usize {
        let mut at = node;
        while self.depth(at) > depth {
            at = if self.depth(self.jump(at)) >= depth { self.jump(at) } else { self.parent(at) };
        }
        at
    }

    fn lowest_common_ancestor(&self, a: usize, b: usize) -> usize {
        let depth = self.depth(a).min(self.depth(b));
        let (mut a, mut b) = (self.ancestor_at(a, depth), self.ancestor_at(b, depth));
        while a != b {
            (a, b) = if self.jump(a) == self.jump(b) { (self.parent(a), self.parent(b)) } else { (self.jump(a), self.jump(b)) };
        }
        a
    }

    fn is_ancestor(&self, ancestor: usize, node: usize) -> bool {
        self.depth(ancestor) <= self.depth(node) && self.ancestor_at(node, self.depth(ancestor)) == ancestor
    }
}

type Numbers = SmallVec<[usize; 2]>;

/// The segment that stands for the set that `segment` is in. `sets`: for each segment one that is in the same set, or itself.
fn find(sets: &mut [usize], segment: usize) -> usize {
    let mut at = segment;
    while let Some(&parent) = sets.get(at).filter(|it| **it != at) {
        let above = sets.get(parent).copied().unwrap_or(parent);
        if let Some(slot) = sets.get_mut(at) {
            *slot = above;
        }
        at = parent;
    }
    at
}

const NOT_SEEN: usize = usize::MAX;
const GONE_THROUGH: usize = usize::MAX - 1;

/// The blocks of a function, by their numbers: they are numbered in reverse postorder, so that a block comes after all that lead to it,
/// but for those that lead back to it.
struct Blocks<'a> {
    /// What leads to each block, without what leads back. After a loop also what leads back to the start of the loop.
    incoming: Vec<Numbers>,
    /// Where each block leads, without where it leads back.
    outgoing: Vec<Numbers>,
    /// Whether it leads anywhere.
    leads_on: Vec<bool>,
    is_catch_start: Vec<bool>,
    is_in_try_block: Vec<bool>,
    found: Vec<Found<'a>>,
}

impl<'a> Blocks<'a> {
    /// A block is a segment that can be reached. These are one block:
    /// - The segments of a `finally` block that are gone through side by side.
    /// - A segment in the block of a `try` statement and the one that it goes on in after the first expression that can throw.
    ///
    /// As in oxlint's graph, everything in the block of a `try` statement leads to its `catch`.
    fn new(walk: Walk<'a>) -> Option<Blocks<'a>> {
        let initial_segment = walk.code_path?.initial_segment();
        let mut segments = vec![initial_segment];
        let mut number_of: FxHashMap<u32, usize> = FxHashMap::default();
        number_of.insert(initial_segment.id(), 0);
        let mut at = 0;
        while let Some(&segment) = segments.get(at) {
            at += 1;
            for next in segment.next_segments() {
                number_of.entry(next.id()).or_insert_with(|| {
                    segments.push(next);
                    segments.len() - 1
                });
            }
        }
        let number = |segment: Segment<'a>| number_of.get(&segment.id()).copied();
        let catch_starts: FxHashSet<u32> = walk.catch_starts.iter().map(|it| it.0.id()).collect();
        let is_catch_start = |segment: Segment<'a>| catch_starts.contains(&segment.id());

        // The set of segments that each segment is in: that of the segment with this number, or its own.
        let mut sets: Vec<usize> = (0..segments.len()).collect();
        let unite = |sets: &mut [usize], a: usize, with: usize| {
            let (a, with) = (find(sets, a), find(sets, with));
            if let Some(slot) = sets.get_mut(a) {
                *slot = with;
            }
        };
        for &(segment, first) in &walk.side_by_side {
            if let (Some(segment), Some(first)) = (number(segment), number(first)) {
                unite(&mut sets, segment, first);
            }
        }
        for (i, &segment) in segments.iter().enumerate() {
            if let [prev] = segment.prev_segments().as_slice()
                && !is_catch_start(segment)
                && let next = prev.next_segments()
                && next.len() > 1
                && next.iter().all(|it| *it == segment || is_catch_start(*it))
                && let Some(prev) = number(*prev)
            {
                unite(&mut sets, i, prev);
            }
        }

        // Where each set leads, by the number of the segment that stands for it.
        let mut leads_to: Vec<Numbers> = vec![Numbers::new(); segments.len()];
        let mut edges: FxHashSet<(usize, usize)> = FxHashSet::default();
        let mut lead = |sets: &mut [usize], from: usize, to: usize| {
            let (from, to) = (find(sets, from), find(sets, to));
            if from != to
                && edges.insert((from, to))
                && let Some(all) = leads_to.get_mut(from)
            {
                all.push(to);
            }
        };
        for (i, &segment) in segments.iter().enumerate() {
            for next in segment.next_segments() {
                if let Some(next) = number(next).filter(|_| !is_catch_start(next)) {
                    lead(&mut sets, i, next);
                }
            }
        }
        for (catch_start, in_try_block) in &walk.catch_starts {
            if let Some(catch_start) = number(*catch_start) {
                for segment in in_try_block.iter().filter_map(|it| number(*it)) {
                    lead(&mut sets, segment, catch_start);
                }
            }
        }

        // In reverse postorder. What leads to a set that is being gone through leads back.
        let mut postorder: Vec<usize> = Vec::new();
        // Of each set: one of the two, or where it is in the postorder.
        let mut state: Vec<usize> = vec![NOT_SEEN; segments.len()];
        let mut leads_back: FxHashSet<(usize, usize)> = FxHashSet::default();
        let first = find(&mut sets, 0);
        let mut stack: Vec<(usize, usize)> = vec![(first, 0)];
        if let Some(slot) = state.get_mut(first) {
            *slot = GONE_THROUGH;
        }
        while let Some(top) = stack.last_mut() {
            let (set, done) = *top;
            top.1 += 1;
            // The last first, so that the first comes first in the end.
            let next = leads_to.get(set).and_then(|all| all.len().checked_sub(done + 1).and_then(|it| all.get(it))).copied();
            let Some(next) = next else {
                if let Some(slot) = state.get_mut(set) {
                    *slot = postorder.len();
                }
                postorder.push(set);
                stack.pop();
                continue;
            };
            match state.get(next).copied() {
                Some(NOT_SEEN) => {
                    if let Some(slot) = state.get_mut(next) {
                        *slot = GONE_THROUGH;
                    }
                    stack.push((next, 0));
                }
                Some(GONE_THROUGH) => {
                    leads_back.insert((set, next));
                }
                _ => {}
            }
        }
        let len = postorder.len();
        // The number of the block that a set is.
        let block_of = |set: usize| state.get(set).and_then(|it| len.checked_sub(it.checked_add(1)?));

        let mut blocks = Blocks {
            incoming: vec![Numbers::new(); len],
            outgoing: vec![Numbers::new(); len],
            leads_on: vec![false; len],
            is_catch_start: vec![false; len],
            is_in_try_block: vec![false; len],
            found: std::iter::repeat_with(Found::default).take(len).collect(),
        };
        // What leads to each block, and what leads back to it.
        let mut forward: Vec<Numbers> = vec![Numbers::new(); len];
        let mut back: Vec<Numbers> = vec![Numbers::new(); len];
        for (from, &set) in postorder.iter().rev().enumerate() {
            for &next in leads_to.get(set).into_iter().flatten() {
                let Some(to) = block_of(next) else {
                    continue;
                };
                let is_back = leads_back.contains(&(set, next));
                let leading_there = if is_back { &mut back } else { &mut forward };
                if let Some(all) = leading_there.get_mut(to) {
                    all.push(from);
                }
                if let Some(all) = blocks.outgoing.get_mut(from).filter(|_| !is_back) {
                    all.push(to);
                }
                if let Some(slot) = blocks.leads_on.get_mut(from) {
                    *slot = true;
                }
            }
        }
        // The last block that each block has been added to.
        let mut added_to: Vec<usize> = vec![usize::MAX; len];
        for (block, incoming) in blocks.incoming.iter_mut().enumerate() {
            for &before in forward.get(block).into_iter().flatten() {
                let after_loop = back.get(before).into_iter().flatten().copied().filter(|it| *it < block);
                for it in after_loop.chain([before]) {
                    if let Some(slot) = added_to.get_mut(it).filter(|slot| **slot != block) {
                        *slot = block;
                        incoming.push(it);
                    }
                }
            }
        }

        let mut found = walk.found;
        for (i, segment) in segments.iter().enumerate() {
            let Some(block) = block_of(find(&mut sets, i)) else {
                continue;
            };
            if let Some(slot) = blocks.is_catch_start.get_mut(block).filter(|_| is_catch_start(*segment)) {
                *slot = true;
            }
            if let Some(slot) = blocks.is_in_try_block.get_mut(block).filter(|_| walk.in_try_block.contains(&segment.id())) {
                *slot = true;
            }
            if let (Some(of_segment), Some(of_block)) = (found.remove(&segment.id()), blocks.found.get_mut(block)) {
                of_block.resolved.extend(of_segment.resolved);
                let last = [of_block.last_throwable_expr_span, of_segment.last_throwable_expr_span];
                of_block.last_throwable_expr_span = last.into_iter().flatten().max_by_key(|it| it.start);
            }
        }
        for found in &mut blocks.found {
            found.resolved.sort_unstable_by_key(|it| it.span().start);
        }
        Some(blocks)
    }

    fn out_going_block_count(&self, block: usize) -> usize {
        match self.outgoing.get(block).map_or(0, |it| it.len()) {
            0 => usize::from(self.leads_on.get(block) == Some(&true)),
            count => count,
        }
    }
}

/// Checks the code path of `func`.
fn check<'a>(func: Func<'a>, resolve_finder: ResolveFinder<'a>, diagnostics: &mut Diagnostics<'a>) {
    if !matches!(func.body(), FnBody::Block(_)) {
        return;
    }
    let walk = Walk::new(func, resolve_finder);
    if walk.found.values().map(|it| it.resolved.len()).sum::<usize>() < 2 {
        return;
    }
    let Some(blocks) = Blocks::new(walk) else {
        return;
    };
    let incoming_of = |block: usize| blocks.incoming.get(block).map_or(&[][..], |it| it.as_slice());

    // What each block resolves itself.
    let mut resolved_infos: Vec<BlockResolvedInfo<'a>> = Vec::with_capacity(blocks.found.len());
    for (block, found) in blocks.found.iter().enumerate() {
        let is_throwable_after_resolved = || match (found.resolved.last(), found.last_throwable_expr_span) {
            (Some(resolved), Some(span)) if span.start > resolved.span().end => true,
            _ => {
                let incoming = incoming_of(block);
                !incoming.is_empty() && incoming.iter().all(|it| resolved_infos.get(*it).is_some_and(|it| it.throwable_after_resolved))
            }
        };
        let throwable_after_resolved = blocks.is_in_try_block.get(block) == Some(&true) && is_throwable_after_resolved();
        let first_resolved = found.resolved.first().copied();
        if let Some(first_resolved) = first_resolved {
            diagnostics.extend(found.resolved.iter().skip(1).map(|it| (ALREADY_RESOLVED, *it, first_resolved)));
        }
        resolved_infos.push(BlockResolvedInfo {
            resolved: first_resolved,
            kind: if first_resolved.is_some() { ResolvedKind::Certain } else { ResolvedKind::None },
            throwable_after_resolved,
        });
    }

    // What all ways to a block lead through, and what all ways on from it lead through. In the trees a block has its number plus one.
    let len = blocks.found.len();
    let (mut dominators, mut post_dominators) = (Tree::new(len + 1), Tree::new(len + 1));
    for block in 0..len {
        let all = incoming_of(block).iter().map(|it| it + 1);
        let parent = all.reduce(|a, b| dominators.lowest_common_ancestor(a, b)).unwrap_or(0);
        dominators.add(block + 1, parent);
    }
    for block in (0..len).rev() {
        let all = blocks.outgoing.get(block).into_iter().flatten().map(|it| it + 1);
        let parent = all.reduce(|a, b| post_dominators.lowest_common_ancestor(a, b)).unwrap_or(0);
        post_dominators.add(block + 1, parent);
    }

    for block in 1..len {
        let incoming = incoming_of(block);
        let is_catch_start = blocks.is_catch_start.get(block) == Some(&true);
        let mut certain_resolved_num = 0;
        let (mut first_certain_resolved, mut first_potential_resolved) = (None, None);
        for &before in incoming {
            let Some(resolved_info) = resolved_infos.get(before) else {
                continue;
            };
            if is_catch_start && !resolved_info.throwable_after_resolved {
                continue;
            }
            match resolved_info.kind {
                ResolvedKind::Certain => {
                    certain_resolved_num += 1;
                    first_certain_resolved = first_certain_resolved.or(resolved_info.resolved);
                }
                ResolvedKind::Potential => {
                    if first_potential_resolved.is_none() && blocks.out_going_block_count(before) == 1 {
                        first_potential_resolved = resolved_info.resolved;
                    }
                }
                ResolvedKind::None => {}
            }
        }
        let (prev_resolved, prev_resolved_kind) = if certain_resolved_num == incoming.len() && !incoming.is_empty() {
            // All paths to the block are certain.
            (first_certain_resolved, ResolvedKind::Certain)
        } else if first_certain_resolved.is_some() {
            (first_certain_resolved, ResolvedKind::Potential)
        } else if first_potential_resolved.is_some() {
            (first_potential_resolved, ResolvedKind::Potential)
        } else {
            // Where ways join again, as where they parted.
            let dominator = dominators.parent(block + 1);
            let joins = incoming.len() > 1 && !is_catch_start && dominator != 0 && post_dominators.is_ancestor(block + 1, dominator);
            match dominator.checked_sub(1).filter(|_| joins).and_then(|it| resolved_infos.get(it)) {
                Some(resolved_info) => (resolved_info.resolved, resolved_info.kind),
                None => (None, ResolvedKind::None),
            }
        };
        if prev_resolved_kind == ResolvedKind::None {
            continue;
        }
        let Some(resolved_info) = resolved_infos.get_mut(block) else {
            return;
        };
        if resolved_info.kind != ResolvedKind::Certain {
            resolved_info.resolved = prev_resolved;
            resolved_info.kind = prev_resolved_kind;
        } else if let (Some(prev_resolved), Some(resolved)) = (prev_resolved, resolved_info.resolved) {
            let is_certain = prev_resolved_kind == ResolvedKind::Certain;
            diagnostics.push((if is_certain { ALREADY_RESOLVED } else { POTENTIALLY_ALREADY_RESOLVED }, resolved, prev_resolved));
        }
    }
}
